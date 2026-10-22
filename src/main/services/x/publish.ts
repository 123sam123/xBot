import { createHash, randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PostPayload, PublishJob, PublishJobError, ReconcileResult, XEvents } from '../../../shared/contracts/x';
import { ACTIVE_STATUSES, mediaCategory, postViolation, type JobStatus, type MediaCategory } from '../../../shared/xRules';
import type { Db } from '../../db';
import { durable } from '../../db/durable';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import type { DraftsService } from '../drafts/service';
import { createSerialQueue } from '../drafts/queue';
import type { AccountStore } from './accounts';
import { XApiError, type XApi } from './api';
import { describeApiError, type XCallSite } from './errors';
import { findMatch } from './reconcile';

// The publish pipeline: one persisted job per Post ↑, frozen at creation, moved
// through the states in docs/ARCHITECTURE.md → "X publishing" by
// compare-and-swap updates, each logged in publish_job_events. No `electron`
// import. The rules that keep it from ever double-posting:
//   - a draft has at most one active job, and the same content maps to one job;
//   - the "create request is about to be sent" write is durable (fsynced) and
//     comes before the request;
//   - a create whose outcome is unknown is never re-sent on its own: the job
//     waits in needs_reconciliation, and any later create first looks on X.

const ACTIVE_SQL = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ');
/** Uploaded media this close to X's expiry is uploaded again rather than reused. */
const MEDIA_REUSE_MARGIN_MS = 10 * 60_000;
const RECONCILE_WINDOW_MS = 5 * 60_000;
const RECONCILE_MAX_PAGES = 5;
const PROGRESS_EVENT_MS = 250;
const PROGRESS_WRITE_MS = 1000;

interface JobRow {
  id: string;
  draft_id: string | null;
  account_id: string | null;
  account_x_user_id: string;
  account_handle: string;
  idempotency_key: string;
  frozen_text: string;
  status: JobStatus;
  progress_phase: 'upload' | 'processing' | null;
  progress_percent: number | null;
  remote_post_id: string | null;
  remote_url: string | null;
  error_code: string | null;
  error_detail: string | null;
  rate_limit_reset_at: string | null;
  attempts: number;
  create_sent_at: string | null;
  uncertain_since: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface JobMediaRow {
  job_id: string;
  position: number;
  media_id: string | null;
  frozen_media_id: string;
  mime: string;
  bytes: number;
  name: string;
  media_category: MediaCategory;
  remote_state: 'none' | 'initialized' | 'appended' | 'finalized' | 'ready';
  remote_media_id: string | null;
  remote_media_key: string | null;
  remote_expires_at: string | null;
}

/** The file to upload for a frozen attachment. T4 points this at the rendered edit. */
export type ResolvePostMedia = (m: { frozenMediaId: string; name: string }) => Promise<{ path: string; bytes: number } | null>;

type JobColumns = Partial<Omit<JobRow, 'id' | 'status' | 'created_at' | 'idempotency_key'>>;

export interface PublisherDeps {
  db: Db;
  accounts: AccountStore;
  api: XApi;
  drafts: Pick<DraftsService, 'get'>;
  /** userData/media, for the default ResolvePostMedia. */
  mediaRoot: string;
  emit<K extends keyof XEvents>(name: K, payload: XEvents[K]): void;
  log: Logger;
  preview?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Give up on X's media processing after this long. */
  processingTimeoutMs?: number;
  chunkBytes?: number;
  resolvePostMedia?: ResolvePostMedia;
  onActivity?: () => void;
}

export interface Publisher {
  /** Marks interrupted jobs (launch after a quit or crash). Never re-creates or re-sends anything. */
  recover(): void;
  post(payload: PostPayload): Promise<PublishJob>;
  openJobs(): PublishJob[];
  cancel(jobId: string): PublishJob;
  retry(jobId: string): Promise<PublishJob>;
  reconcile(jobId: string): Promise<ReconcileResult>;
  markNotPosted(jobId: string): PublishJob;
  dismiss(jobId: string): void;
  /** Busy / uncertain counts for the status chip, from the database only. */
  summary(): { running: number; uncertain: number };
  /** Resolves at once unless a create request is in flight; then waits up to `maxMs` and aborts it. */
  settleForQuit(maxMs: number): Promise<void>;
  /** Waits until the runner has nothing left to do (tests). */
  idle(): Promise<void>;
  dispose(): void;
}

const postUrl = (id: string) => `https://x.com/i/web/status/${id}`;
const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function idempotencyKey(draftId: string, xUserId: string, text: string, mediaIds: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([draftId, xUserId, text, mediaIds])).digest('hex');
}

export function createPublisher(deps: PublisherDeps): Publisher {
  const { db, accounts, api, drafts, log } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const processingTimeoutMs = deps.processingTimeoutMs ?? 15 * 60_000;
  const chunkBytes = deps.chunkBytes ?? 4 * 1024 * 1024;
  const iso = () => new Date(now()).toISOString();

  const resolvePostMedia: ResolvePostMedia =
    deps.resolvePostMedia ??
    (async ({ frozenMediaId }) => {
      const row = db.prepare<[string], { path: string }>('SELECT path FROM media WHERE id = ?').get(frozenMediaId);
      if (!row) return null;
      const path = join(deps.mediaRoot, row.path);
      try {
        const info = await stat(path);
        return info.isFile() ? { path, bytes: info.size } : null;
      } catch {
        return null;
      }
    });

  const q = {
    job: db.prepare<[string], JobRow>('SELECT * FROM publish_jobs WHERE id = ?'),
    byKey: db.prepare<[string], JobRow>('SELECT * FROM publish_jobs WHERE idempotency_key = ?'),
    activeForDraft: db.prepare<[string], JobRow>(`SELECT * FROM publish_jobs WHERE draft_id = ? AND status IN (${ACTIVE_SQL})`),
    media: db.prepare<[string], JobMediaRow>('SELECT * FROM publish_job_media WHERE job_id = ? ORDER BY position'),
    nextQueued: db.prepare<[], { id: string }>("SELECT id FROM publish_jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1"),
    open: db.prepare<[], JobRow>(
      `SELECT * FROM publish_jobs
       WHERE status IN (${ACTIVE_SQL}) OR (status IN ('failed', 'published') AND dismissed_at IS NULL)
       ORDER BY created_at DESC, rowid DESC LIMIT 20`,
    ),
    insertJob: db.prepare(
      `INSERT INTO publish_jobs (id, draft_id, account_id, account_x_user_id, account_handle, idempotency_key, frozen_text, status, attempts, created_at, updated_at)
       VALUES (@id, @draft_id, @account_id, @account_x_user_id, @account_handle, @idempotency_key, @frozen_text, 'queued', 0, @now, @now)`,
    ),
    insertMedia: db.prepare(
      `INSERT INTO publish_job_media (job_id, position, media_id, frozen_media_id, mime, bytes, name, media_category)
       VALUES (@job_id, @position, @media_id, @media_id, @mime, @bytes, @name, @media_category)`,
    ),
    event: db.prepare('INSERT INTO publish_job_events (job_id, at, from_status, to_status, detail) VALUES (?, ?, ?, ?, ?)'),
    createEvents: db.prepare<[string], { detail: string | null }>(
      "SELECT detail FROM publish_job_events WHERE job_id = ? AND to_status = 'publishing' ORDER BY id",
    ),
    releaseMedia: db.prepare('UPDATE publish_job_media SET media_id = NULL WHERE job_id = ?'),
    rebindMedia: db.prepare(
      'UPDATE publish_job_media SET media_id = frozen_media_id WHERE job_id = ? AND EXISTS (SELECT 1 FROM media m WHERE m.id = publish_job_media.frozen_media_id)',
    ),
    resetStaleMedia: db.prepare(
      "UPDATE publish_job_media SET remote_state = 'none', remote_media_id = NULL, remote_media_key = NULL, remote_expires_at = NULL WHERE job_id = ? AND NOT (remote_state = 'ready' AND remote_expires_at > ?)",
    ),
    dismissPublished: db.prepare("UPDATE publish_jobs SET dismissed_at = ? WHERE status = 'published' AND dismissed_at IS NULL"),
    releasePublishedMedia: db.prepare(
      "UPDATE publish_job_media SET media_id = NULL WHERE job_id IN (SELECT id FROM publish_jobs WHERE status = 'published')",
    ),
    counts: db.prepare<[], { running: number; uncertain: number }>(
      `SELECT
         SUM(status IN ('queued', 'uploading', 'processing', 'publishing')) AS running,
         SUM(status = 'needs_reconciliation') AS uncertain
       FROM publish_jobs`,
    ),
  };

  let disposed = false;
  const disposeController = new AbortController();
  const runner = createSerialQueue();
  const intake = createSerialQueue();
  const jobLocks = new Map<string, Promise<unknown>>();
  const jobAborts = new Map<string, AbortController>();
  const progressMemo = new Map<string, { phase: 'upload' | 'processing'; percent: number; emittedAt: number; writtenAt: number }>();
  let createInFlight: Promise<unknown> | null = null;
  let draining: Promise<void> = Promise.resolve();

  function row(jobId: string): JobRow {
    const found = q.job.get(jobId);
    if (!found) throw new IpcError('x_job_not_found', 'That post is no longer in xBot’s list.');
    return found;
  }

  function toJob(r: JobRow): PublishJob {
    const media = q.media.all(r.id);
    const live = progressMemo.get(r.id);
    const progress =
      r.status === 'uploading' || r.status === 'processing'
        ? live
          ? { phase: live.phase, percent: live.percent }
          : r.progress_phase
            ? { phase: r.progress_phase, percent: r.progress_percent ?? 0 }
            : null
        : null;
    const error: PublishJobError | null = r.error_code
      ? { code: r.error_code, message: r.error_detail ?? '', ...(r.rate_limit_reset_at ? { resetAt: r.rate_limit_reset_at } : {}) }
      : null;
    return {
      id: r.id,
      draftId: r.draft_id,
      accountHandle: r.account_handle,
      frozenText: r.frozen_text,
      mediaIds: media.map((m) => m.frozen_media_id),
      status: r.status,
      progress,
      remotePostId: r.remote_post_id,
      remoteUrl: r.remote_url,
      error,
      attempts: r.attempts,
      uncertain: r.uncertain_since !== null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  const snapshot = (jobId: string) => toJob(row(jobId));

  function changed(jobId: string): void {
    if (disposed || !db.open) return;
    deps.emit('x:job-changed', { job: snapshot(jobId) });
    deps.onActivity?.();
  }

  /**
   * Compare-and-swap: moves the job to `to` only if it is in one of `from` (and,
   * with `attempts`, still on that attempt). Logs the event and notifies.
   */
  function transitionTx(
    jobId: string,
    from: JobStatus | readonly JobStatus[],
    to: JobStatus,
    set: JobColumns = {},
    opts: { detail?: string; attempts?: number } = {},
  ): boolean {
    const fromList = typeof from === 'string' ? [from] : from;
    const current = q.job.get(jobId);
    if (!current || !fromList.includes(current.status)) return false;
    if (opts.attempts !== undefined && current.attempts !== opts.attempts) return false;
    const columns = { ...set, updated_at: iso() };
    const assignments = Object.keys(columns).map((k) => `${k} = @${k}`);
    const sql = `UPDATE publish_jobs SET status = @to, ${assignments.join(', ')} WHERE id = @id AND status = @from${
      opts.attempts !== undefined ? ' AND attempts = @expectedAttempts' : ''
    }`;
    const params: Record<string, unknown> = { ...columns, to, id: jobId, from: current.status };
    if (opts.attempts !== undefined) params.expectedAttempts = opts.attempts;
    if (db.prepare(sql).run(params).changes === 0) return false;
    q.event.run(jobId, iso(), current.status, to, opts.detail ?? null);
    if (to !== 'uploading' && to !== 'processing') progressMemo.delete(jobId);
    return true;
  }

  function transition(...args: Parameters<typeof transitionTx>): boolean {
    if (!db.open) return false; // quitting: the database is already closed
    const moved = db.transaction(() => transitionTx(...args))();
    if (moved) changed(args[0]);
    return moved;
  }

  function durableTransition(...args: Parameters<typeof transitionTx>): boolean {
    if (disposed || !db.open) return false;
    const moved = durable(db, () => transitionTx(...args));
    if (moved) changed(args[0]);
    return moved;
  }

  function setMedia(jobId: string, position: number, set: Partial<JobMediaRow>): void {
    const keys = Object.keys(set);
    if (keys.length === 0) return;
    db.prepare(`UPDATE publish_job_media SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE job_id = @job_id AND position = @position`).run({
      ...set,
      job_id: jobId,
      position,
    });
  }

  function progress(jobId: string, phase: 'upload' | 'processing', percent: number): void {
    if (disposed || !db.open) return;
    const t = now();
    const memo = progressMemo.get(jobId) ?? { phase, percent, emittedAt: 0, writtenAt: 0 };
    memo.phase = phase;
    memo.percent = Math.max(0, Math.min(100, Math.round(percent)));
    progressMemo.set(jobId, memo);
    if (t - memo.writtenAt >= PROGRESS_WRITE_MS || memo.percent === 100) {
      memo.writtenAt = t;
      db.prepare('UPDATE publish_jobs SET progress_phase = ?, progress_percent = ? WHERE id = ?').run(phase, memo.percent, jobId);
    }
    if (t - memo.emittedAt >= PROGRESS_EVENT_MS || memo.percent === 100) {
      memo.emittedAt = t;
      changed(jobId);
    }
  }

  /** Serialises reconcile checks and Retry post for one job (not behind other jobs' uploads). */
  function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
    const previous = jobLocks.get(jobId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.catch(() => {});
    jobLocks.set(jobId, tail);
    void tail.then(() => {
      if (jobLocks.get(jobId) === tail) jobLocks.delete(jobId);
    });
    return run;
  }

  /** The account the job was frozen to: its row, or the same X user reconnected under a new row. */
  function accountIdFor(job: JobRow): string {
    if (job.account_id && accounts.get(job.account_id)) return job.account_id;
    const again = accounts.byXUserId(job.account_x_user_id);
    if (!again) throw new IpcError('x_reconnect', `@${job.account_handle} isn’t connected anymore. Reconnect it to finish this post.`);
    db.prepare('UPDATE publish_jobs SET account_id = ? WHERE id = ?').run(again.id, job.id);
    return again.id;
  }

  /** Runs an idempotent call with the job's own account token; a 401 refreshes once and repeats it. */
  async function withToken<T>(job: JobRow, fn: (token: string) => Promise<T>): Promise<T> {
    const accountId = accountIdFor(job);
    const token = await accounts.accessToken(accountId);
    try {
      return await fn(token);
    } catch (err) {
      if (!(err instanceof XApiError) || err.status !== 401) throw err;
      const fresh = await accounts.refreshAfterRejection(accountId, token);
      try {
        return await fn(fresh);
      } catch (again) {
        if (again instanceof XApiError && again.status === 401) accounts.markReconnect(accountId);
        throw again;
      }
    }
  }

  function errorColumns(e: PublishJobError): JobColumns {
    return { error_code: e.code, error_detail: e.message, rate_limit_reset_at: e.resetAt ?? null };
  }

  /** A definitive failure — unless an earlier create is still unaccounted for, which keeps the job in reconciliation. */
  function fail(jobId: string, from: readonly JobStatus[], e: PublishJobError): void {
    const current = q.job.get(jobId);
    if (!current) return;
    if (current.uncertain_since) {
      transition(jobId, from, 'needs_reconciliation', { ...errorColumns(e), progress_phase: null, progress_percent: null }, { detail: e.code });
    } else {
      transition(jobId, from, 'failed', { ...errorColumns(e), progress_phase: null, progress_percent: null, finished_at: iso() }, { detail: e.code });
    }
  }

  function uncertain(jobId: string, detail: string): void {
    const current = q.job.get(jobId);
    if (!current) return;
    transition(
      jobId,
      'publishing',
      'needs_reconciliation',
      {
        uncertain_since: current.uncertain_since ?? current.create_sent_at ?? iso(),
        error_code: 'x_uncertain',
        error_detail: 'X didn’t confirm this post, so it may or may not be on X. Check X before posting it again.',
        rate_limit_reset_at: null,
      },
      { detail },
    );
  }

  function published(jobId: string, postId: string, from: readonly JobStatus[]): void {
    // If the database already closed (quit), the job stays `publishing` and launch reconciles it.
    if (!db.open) return;
    const url = postUrl(postId);
    const moved = db.transaction(() => {
      const ok = transitionTx(
        jobId,
        from,
        'published',
        {
          remote_post_id: postId,
          remote_url: url,
          uncertain_since: null,
          error_code: null,
          error_detail: null,
          rate_limit_reset_at: null,
          finished_at: iso(),
          progress_phase: null,
          progress_percent: null,
        },
        { detail: postId },
      );
      if (ok) q.releaseMedia.run(jobId);
      return ok;
    })();
    if (!moved) return;
    changed(jobId);
    if (!disposed) deps.emit('post:published', { postId, url });
  }

  // ---------------------------------------------------------------- upload

  async function readChunk(path: string, offset: number, length: number): Promise<Buffer> {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new IpcError('x_media_rejected', 'A media file changed while it was being uploaded.');
      return buffer;
    } finally {
      await handle.close();
    }
  }

  const expiresAt = (secs: number | null) => (secs === null ? null : new Date(now() + secs * 1000).toISOString());
  const msLeft = (m: JobMediaRow) => (m.remote_expires_at ? Date.parse(m.remote_expires_at) - now() : -1);
  const isReusable = (m: JobMediaRow) => m.remote_state === 'ready' && msLeft(m) > MEDIA_REUSE_MARGIN_MS;

  async function uploadOne(job: JobRow, m: JobMediaRow, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
    if (isReusable(m)) return onBytes(m.bytes);
    if (m.remote_state === 'finalized' && msLeft(m) > 0) return onBytes(m.bytes);
    const file = await resolvePostMedia({ frozenMediaId: m.frozen_media_id, name: m.name });
    if (!file) throw new IpcError('x_media_rejected', `${m.name} is missing from xBot’s media folder, so it can’t be uploaded.`);

    const init = await withToken(job, (t) => api.initUpload(t, { mediaType: m.mime, totalBytes: file.bytes, category: m.media_category }, { signal }));
    setMedia(job.id, m.position, {
      remote_state: 'initialized',
      remote_media_id: init.id,
      remote_media_key: init.mediaKey,
      remote_expires_at: expiresAt(init.expiresAfterSecs ?? 86_400),
    });
    for (let offset = 0, segment = 0; offset < file.bytes; offset += chunkBytes, segment++) {
      const chunk = await readChunk(file.path, offset, Math.min(chunkBytes, file.bytes - offset));
      await withToken(job, (t) => api.appendUpload(t, init.id, segment, chunk, { signal }));
      onBytes(chunk.length);
    }
    setMedia(job.id, m.position, { remote_state: 'appended' });

    let result: Awaited<ReturnType<XApi['finalizeUpload']>>;
    try {
      result = await withToken(job, (t) => api.finalizeUpload(t, init.id, { signal }));
    } catch (err) {
      // A finalize whose answer was lost may have worked: ask before giving up.
      if (!(err instanceof XApiError) || !err.uncertain) throw err;
      result = await withToken(job, (t) => api.uploadStatus(t, init.id, { signal }));
    }
    const info = result.processing;
    if (info?.state === 'failed') throw new IpcError('x_media_rejected', `X couldn’t process ${m.name}${info.error ? `: ${info.error}` : '.'}`);
    setMedia(job.id, m.position, {
      remote_state: !info || info.state === 'succeeded' ? 'ready' : 'finalized',
      ...(result.expiresAfterSecs !== null ? { remote_expires_at: expiresAt(result.expiresAfterSecs) } : {}),
    });
  }

  async function waitForProcessing(job: JobRow, signal: AbortSignal): Promise<void> {
    const pending = q.media.all(job.id).filter((m) => m.remote_state === 'finalized');
    const deadline = now() + processingTimeoutMs;
    for (const [index, m] of pending.entries()) {
      let delaySecs = 1;
      for (;;) {
        if (signal.aborted) throw new XApiError('aborted', null, null, 'The request was stopped.');
        if (now() > deadline) throw new IpcError('x_media_rejected', `X is still processing ${m.name} after ${Math.round(processingTimeoutMs / 60_000)} minutes. Try again later.`);
        await sleep(Math.min(30, Math.max(1, delaySecs)) * 1000);
        const status = await withToken(job, (t) => api.uploadStatus(t, m.remote_media_id!, { signal }));
        const info = status.processing;
        if (!info || info.state === 'succeeded') {
          setMedia(job.id, m.position, { remote_state: 'ready', ...(status.expiresAfterSecs !== null ? { remote_expires_at: expiresAt(status.expiresAfterSecs) } : {}) });
          break;
        }
        if (info.state === 'failed') throw new IpcError('x_media_rejected', `X couldn’t process ${m.name}${info.error ? `: ${info.error}` : '.'}`);
        progress(job.id, 'processing', ((index + (info.percent ?? 0) / 100) / pending.length) * 100);
        delaySecs = info.checkAfterSecs ?? delaySecs * 2;
      }
    }
  }

  // ---------------------------------------------------------------- create

  /**
   * The only place a create request is sent. The durable move into
   * `publishing` (with attempts + 1 and create_sent_at) lands before the
   * request; afterwards the job is published, failed, or uncertain — never
   * re-sent here, except once after a 401 (which means nothing was created).
   */
  async function createOnce(jobId: string, from: readonly JobStatus[]): Promise<void> {
    let job = row(jobId);
    const accountId = accountIdFor(job);
    let token = await accounts.accessToken(accountId); // refreshed before the durable write, not after
    const mediaIds = q.media.all(jobId).map((m) => m.remote_media_id!);
    let attempts = job.attempts;
    const sent = { attempts: attempts + 1, create_sent_at: iso(), progress_phase: null, progress_percent: null };
    if (!durableTransition(jobId, from, 'publishing', sent, { detail: JSON.stringify({ mediaIds }) })) return;
    attempts += 1;
    let refreshed = false;
    for (;;) {
      job = row(jobId);
      const request = api.createPost(token, { text: job.frozen_text, mediaIds }, { signal: disposeController.signal });
      createInFlight = request;
      try {
        const { id } = await request;
        published(jobId, id, ['publishing']);
        return;
      } catch (err) {
        if (disposed || (err instanceof XApiError && err.kind === 'aborted')) return; // quitting: write nothing; launch reconciles
        if (!(err instanceof XApiError) || err.uncertain || err.kind === 'invalid_response') {
          uncertain(jobId, err instanceof XApiError ? err.message : 'unexpected error');
          return;
        }
        if (err.status === 401 && !refreshed) {
          refreshed = true;
          try {
            token = await accounts.refreshAfterRejection(accountId, token);
          } catch (refreshErr) {
            fail(jobId, ['publishing'], describeApiError(refreshErr, 'create', job.account_handle));
            return;
          }
          const again = { attempts: attempts + 1, create_sent_at: iso() };
          if (!durableTransition(jobId, 'publishing', 'publishing', again, { attempts, detail: JSON.stringify({ mediaIds }) })) return;
          attempts += 1;
          continue;
        }
        if (err.status === 401) accounts.markReconnect(accountId);
        fail(jobId, ['publishing'], describeApiError(err, 'create', job.account_handle));
        return;
      } finally {
        createInFlight = null;
      }
    }
  }

  async function process(jobId: string): Promise<void> {
    if (!transition(jobId, 'queued', 'uploading', { progress_phase: 'upload', progress_percent: 0, error_code: null, error_detail: null })) return;
    const abort = new AbortController();
    jobAborts.set(jobId, abort);
    const signal = AbortSignal.any([abort.signal, disposeController.signal]);
    let site: XCallSite = 'media';
    try {
      const job = row(jobId);
      const media = q.media.all(jobId);
      const total = media.reduce((sum, m) => sum + m.bytes, 0);
      let done = 0;
      for (const m of media) {
        await uploadOne(job, m, signal, (n) => {
          done += n;
          if (total > 0) progress(jobId, 'upload', (done / total) * 100);
        });
      }
      if (q.media.all(jobId).some((m) => m.remote_state === 'finalized')) {
        if (!transition(jobId, 'uploading', 'processing', { progress_phase: 'processing', progress_percent: 0 })) return;
        await waitForProcessing(job, signal);
      }
      site = 'create';
      await createOnce(jobId, ['uploading', 'processing']);
    } catch (err) {
      if (disposed || abort.signal.aborted) return; // canceled (the cancel already moved it) or quitting
      if (!(err instanceof XApiError) && !(err instanceof IpcError)) log.error('x: publish job failed', err instanceof Error ? err.name : 'error');
      const current = q.job.get(jobId);
      fail(jobId, ['queued', 'uploading', 'processing'], describeApiError(err, site, current?.account_handle));
    } finally {
      jobAborts.delete(jobId);
    }
  }

  function kick(): void {
    if (disposed) return;
    draining = runner(async () => {
      for (let next = q.nextQueued.get(); next && !disposed; next = q.nextQueued.get()) {
        await process(next.id);
        // A job process() could not move out of `queued` would spin; fail it instead.
        const stuck = q.job.get(next.id);
        if (stuck?.status === 'queued') fail(next.id, ['queued'], { code: 'x_failed', message: 'xBot couldn’t start this post.' });
      }
    });
  }

  // ---------------------------------------------------------------- reconcile

  async function findOnX(job: JobRow): Promise<{ id: string } | null> {
    const anchor = job.uncertain_since ?? job.create_sent_at ?? job.created_at;
    const startTime = isoSeconds(Date.parse(anchor) - RECONCILE_WINDOW_MS);
    const mediaIdSets = q.createEvents
      .all(job.id)
      .map((e) => {
        try {
          return (JSON.parse(e.detail ?? '{}') as { mediaIds?: string[] }).mediaIds ?? [];
        } catch {
          return [];
        }
      })
      .filter((ids) => ids.every(Boolean));
    const hasMedia = q.media.all(job.id).length > 0;
    if (hasMedia && mediaIdSets.length === 0) return null; // never sent with media ids: nothing to look for
    const target = { frozenText: job.frozen_text, mediaIdSets: hasMedia ? mediaIdSets : [] };
    const posts = [];
    let pageToken: string | undefined;
    for (let page = 0; page < RECONCILE_MAX_PAGES; page++) {
      const result = await withToken(job, (t) => api.userPosts(t, job.account_x_user_id, { startTime, paginationToken: pageToken }));
      posts.push(...result.posts);
      if (findMatch(posts, target) || !result.nextToken) break;
      pageToken = result.nextToken;
    }
    return findMatch(posts, target);
  }

  async function reconcileLocked(jobId: string): Promise<ReconcileResult> {
    const job = row(jobId);
    if (job.status === 'published') return { job: toJob(job), found: true };
    if (job.status !== 'needs_reconciliation') throw new IpcError('x_not_uncertain', 'This post isn’t waiting to be checked.');
    let found: { id: string } | null;
    try {
      found = await findOnX(job);
    } catch (err) {
      const { code, message } = describeApiError(err, 'read', job.account_handle);
      throw new IpcError(code, message);
    }
    if (found) {
      published(jobId, found.id, ['needs_reconciliation']);
      return { job: snapshot(jobId), found: true };
    }
    q.event.run(jobId, iso(), job.status, job.status, 'checked X: not found');
    return { job: toJob(job), found: false };
  }

  function rateLimited(job: JobRow): void {
    if (job.rate_limit_reset_at && Date.parse(job.rate_limit_reset_at) > now()) {
      const d = new Date(job.rate_limit_reset_at);
      const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      throw new IpcError('x_rate_limited', `X rate-limited this account until ${hhmm}. Try again then.`);
    }
  }

  function requeueTx(jobId: string, from: JobStatus | readonly JobStatus[]): boolean {
    const job = q.job.get(jobId);
    if (!job) return false;
    const accountId = accounts.get(job.account_id ?? '') ? job.account_id : (accounts.byXUserId(job.account_x_user_id)?.id ?? null);
    const moved = transitionTx(jobId, from, 'queued', {
      account_id: accountId,
      error_code: null,
      error_detail: null,
      rate_limit_reset_at: null,
      dismissed_at: null,
      finished_at: null,
      progress_phase: null,
      progress_percent: null,
    });
    if (moved) {
      q.rebindMedia.run(jobId);
      q.resetStaleMedia.run(jobId, new Date(now() + MEDIA_REUSE_MARGIN_MS).toISOString());
    }
    return moved;
  }

  // ---------------------------------------------------------------- API

  return {
    recover() {
      const interrupted = db
        .prepare<[], JobRow>("SELECT * FROM publish_jobs WHERE status IN ('queued', 'uploading', 'processing', 'publishing')")
        .all();
      for (const job of interrupted) {
        if (job.status === 'publishing' || job.uncertain_since) {
          transition(
            job.id,
            job.status,
            'needs_reconciliation',
            {
              uncertain_since: job.uncertain_since ?? job.create_sent_at ?? job.updated_at,
              error_code: 'x_uncertain',
              error_detail: 'xBot quit while X was being asked to post this, so it may or may not be on X. Check X before posting it again.',
              progress_phase: null,
              progress_percent: null,
            },
            { detail: 'interrupted' },
          );
        } else {
          transition(
            job.id,
            job.status,
            'failed',
            {
              error_code: 'x_interrupted',
              error_detail: 'xBot quit before this was posted. Nothing reached X. Try again to post it.',
              progress_phase: null,
              progress_percent: null,
              finished_at: iso(),
            },
            { detail: 'interrupted' },
          );
        }
      }
    },

    post({ draftId, text, attachmentIds }) {
      return intake(async () => {
        if (deps.preview) throw new IpcError('preview_mode', 'Posting is off in preview.');
        if (disposed) throw new IpcError('x_quitting', 'xBot is quitting.');
        const account = accounts.active();
        if (!account) throw new IpcError('x_not_connected', 'Connect an X account first.');
        if (account.reconnect_required) throw new IpcError('x_reconnect', `Reconnect @${account.handle} to keep posting.`);

        const draft = drafts.get(draftId);
        const savedIds = draft.attachments.map((a) => a.id);
        if (draft.text !== text || savedIds.length !== attachmentIds.length || savedIds.some((id, i) => id !== attachmentIds[i])) {
          throw new IpcError('draft_changed', 'Your draft changed while posting started. Check it and post again.');
        }
        const media = draft.attachments.map((a) => a.media);
        const violation = postViolation(text, media);
        if (violation) throw new IpcError(violation.code, violation.message);

        const mediaIds = media.map((m) => m.id);
        const key = idempotencyKey(draftId, account.x_user_id, text, mediaIds);
        const jobId = db.transaction((): string => {
          const active = q.activeForDraft.get(draftId);
          if (active) return active.id;
          const same = q.byKey.get(key);
          if (same) {
            // Published: the repeat click gets the posted job. Failed or canceled (never
            // uncertain: those stay in needs_reconciliation): post the same content again.
            if (same.status === 'failed' || same.status === 'canceled') {
              requeueTx(same.id, same.status);
              q.dismissPublished.run(iso());
              q.releasePublishedMedia.run();
            }
            return same.id;
          }
          const id = randomUUID();
          const stamp = iso();
          q.insertJob.run({
            id,
            draft_id: draftId,
            account_id: account.id,
            account_x_user_id: account.x_user_id,
            account_handle: account.handle,
            idempotency_key: key,
            frozen_text: text,
            now: stamp,
          });
          media.forEach((m, position) =>
            q.insertMedia.run({ job_id: id, position, media_id: m.id, mime: m.mime, bytes: m.bytes, name: m.name, media_category: mediaCategory(m) }),
          );
          q.event.run(id, stamp, null, 'queued', null);
          q.dismissPublished.run(stamp);
          q.releasePublishedMedia.run();
          return id;
        })();
        changed(jobId);
        kick();
        return snapshot(jobId);
      });
    },

    openJobs: () => q.open.all().map(toJob),

    cancel(jobId) {
      const moved = db.transaction(() => {
        const ok = transitionTx(jobId, ['queued', 'uploading', 'processing'], 'canceled', {
          error_code: null,
          error_detail: null,
          finished_at: iso(),
          progress_phase: null,
          progress_percent: null,
        });
        if (ok) q.releaseMedia.run(jobId);
        return ok;
      })();
      if (moved) {
        jobAborts.get(jobId)?.abort();
        changed(jobId);
        return snapshot(jobId);
      }
      const job = row(jobId);
      if (job.status === 'publishing') throw new IpcError('x_job_publishing', 'X is being asked to post this right now, so it can’t be stopped.');
      return toJob(job);
    },

    async retry(jobId) {
      const job = row(jobId);
      if (job.status === 'failed') {
        rateLimited(job);
        if (!db.transaction(() => requeueTx(jobId, 'failed'))()) return snapshot(jobId);
        changed(jobId);
        kick();
        return snapshot(jobId);
      }
      if (job.status === 'needs_reconciliation') {
        return withJobLock(jobId, async () => {
          const current = row(jobId);
          if (current.status !== 'needs_reconciliation') return toJob(current);
          rateLimited(current);
          // Look on X first: an earlier attempt may have posted it.
          const { found } = await reconcileLocked(jobId);
          if (found) return snapshot(jobId);
          const media = q.media.all(jobId);
          if (media.every(isReusable)) {
            await createOnce(jobId, ['needs_reconciliation']);
          } else {
            if (db.transaction(() => requeueTx(jobId, 'needs_reconciliation'))()) changed(jobId);
            kick();
          }
          return snapshot(jobId);
        });
      }
      if (job.status === 'canceled' || job.status === 'published') return toJob(job);
      throw new IpcError('x_job_active', 'This post is still being sent.');
    },

    reconcile: (jobId) => withJobLock(jobId, () => reconcileLocked(jobId)),

    markNotPosted(jobId) {
      const moved = db.transaction(() => {
        const ok = transitionTx(
          jobId,
          'needs_reconciliation',
          'canceled',
          {
            uncertain_since: null,
            error_code: 'marked_not_posted',
            error_detail: 'You marked this as not posted.',
            rate_limit_reset_at: null,
            finished_at: iso(),
          },
          { detail: 'marked not posted' },
        );
        if (ok) q.releaseMedia.run(jobId);
        return ok;
      })();
      if (moved) changed(jobId);
      return snapshot(jobId);
    },

    dismiss(jobId) {
      const job = row(jobId);
      if (job.status !== 'failed' && job.status !== 'published' && job.status !== 'canceled') {
        throw new IpcError('x_job_active', 'This post is still running or waiting to be checked.');
      }
      db.transaction(() => {
        db.prepare('UPDATE publish_jobs SET dismissed_at = ?, updated_at = ? WHERE id = ? AND dismissed_at IS NULL').run(iso(), iso(), jobId);
        q.releaseMedia.run(jobId);
      })();
      changed(jobId);
    },

    summary() {
      const c = q.counts.get();
      return { running: c?.running ?? 0, uncertain: c?.uncertain ?? 0 };
    },

    async settleForQuit(maxMs) {
      const inFlight = createInFlight;
      if (!inFlight) return;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([inFlight.catch(() => {}), new Promise<void>((resolve) => (timer = setTimeout(resolve, maxMs)))]);
      clearTimeout(timer);
      if (createInFlight) disposeController.abort();
    },

    async idle() {
      for (;;) {
        const current = draining;
        await current;
        await Promise.all([...jobLocks.values()]);
        if (current === draining && jobLocks.size === 0) return;
      }
    },

    dispose() {
      disposed = true;
      disposeController.abort();
      for (const abort of jobAborts.values()) abort.abort();
    },
  };
}
