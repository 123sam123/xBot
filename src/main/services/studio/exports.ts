import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { setPriority } from 'node:os';
import { join } from 'node:path';
import { exportLayout } from '../../../shared/composition/layout';
import type { Composition } from '../../../shared/composition/model';
import type { ExportJob, ExportJobStatus, VideoInfo } from '../../../shared/contracts/studio';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import type { AppPaths } from '../../paths';
import { statusChanged } from '../../status';
import type { SerialQueue } from '../drafts/queue';
import { buildExportArgs, progressFromLine } from '../ffmpeg/export';
import type { FfmpegBinaries } from '../ffmpeg/locate';
import { runTool } from '../ffmpeg/run';
import type { ServiceContext } from '../types';

// Video export jobs (T5): one at a time, in order. A job's FFmpeg runs as a
// child process off the drafts queue; only importing the finished MP4 and
// attaching it go through that queue. Each job's files are tmp/<id>.layer.png
// (the frame layer the renderer drew) and tmp/<id>.mp4 (FFmpeg's output);
// both are deleted however the job ends. Cancel sends SIGTERM, then SIGKILL
// after 3 s. Quitting kills FFmpeg at once, and the next start kills an FFmpeg
// that outlived a crash. No `electron` import.

/** Finished jobs older than this are pruned at startup. */
export const JOB_GC_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const KILL_AFTER_MS = 3000;
/** How much of FFmpeg's stderr is kept for the log. */
const STDERR_TAIL = 4096;

export const EXPORT_CANCELED = 'Export canceled.';
export const EXPORT_INTERRUPTED = 'Interrupted: xBot quit during the export.';
const EXPORT_FAILED = 'FFmpeg couldn’t export this video.';

export interface EnqueueInput {
  documentId: string;
  /** The draft the user was writing when they asked; the MP4 goes there (or to the current draft if it's gone). */
  draftId: string;
  openedFromAttachmentId: string | null;
  composition: Composition;
  info: VideoInfo;
  sourcePath: string;
  sourceName: string;
  layer: Uint8Array;
}

export interface FinishInput {
  documentId: string;
  draftId: string;
  openedFromAttachmentId: string | null;
  output: string;
  sourceName: string;
}

export interface ExportRunnerDeps {
  db: Db;
  paths: Pick<AppPaths, 'tmp'>;
  log: Logger;
  events: ServiceContext['events'];
  binaries(): Promise<FfmpegBinaries | null>;
  /** The drafts/media queue. */
  serialize: SerialQueue;
  /** Imports the finished MP4 and attaches it; called on `serialize`. Returns the stored export's id. */
  finish(input: FinishInput): Promise<string>;
  /** Test seam: read the input at its native rate, so an export takes as long as the clip. */
  realtime?: boolean;
  now: () => Date;
}

export interface ExportRunner {
  /** Startup: kills an FFmpeg left from a crash, fails jobs that never finished, prunes old ones. */
  init(): Promise<void>;
  enqueue(input: EnqueueInput): Promise<ExportJob>;
  /** Resolves once the job has stopped and its files are gone. */
  cancel(jobId: string): Promise<ExportJob>;
  get(jobId: string): ExportJob;
  /** The document's queued or running job. */
  activeFor(documentId: string): ExportJob | null;
  /** The job FFmpeg is running now, and how many wait behind it. */
  activity(): { running: ExportJob | null; queued: number };
  /** Quit: kill FFmpeg now, remove the files, record the jobs as canceled. */
  dispose(): void;
}

interface JobRow {
  id: string;
  document_id: string;
  draft_id: string | null;
  kind: 'video';
  status: ExportJobStatus;
  progress: number;
  error: string | null;
  export_id: string | null;
  pid: number | null;
  output_path: string | null;
  created_at: string;
  updated_at: string;
}

interface Entry {
  id: string;
  input: Omit<EnqueueInput, 'layer'>;
  layerPath: string;
  outputPath: string;
  phase: 'queued' | 'encoding' | 'finishing';
  child: ChildProcess | null;
  canceled: boolean;
  settled: Promise<ExportJob>;
  settle(job: ExportJob): void;
}

const toJob = (row: JobRow): ExportJob => ({
  id: row.id,
  documentId: row.document_id,
  status: row.status,
  progress: row.progress,
  error: row.error,
  exportId: row.export_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function errorMessage(stderr: string): string {
  if (/No space left on device/i.test(stderr)) return 'Not enough disk space to export this video.';
  return EXPORT_FAILED;
}

export function createExportRunner({ db, paths, log, events, binaries, serialize, finish, realtime = false, now }: ExportRunnerDeps): ExportRunner {
  const stamp = () => now().toISOString();
  const entries = new Map<string, Entry>();
  const queue: Entry[] = [];
  let current: Entry | null = null;
  let closed = false;

  const q = {
    get: db.prepare<[string], JobRow>('SELECT * FROM export_jobs WHERE id = ?'),
    insert: db.prepare(
      `INSERT INTO export_jobs (id, document_id, draft_id, kind, status, progress, created_at, updated_at)
       VALUES (?, ?, ?, 'video', 'queued', 0, ?, ?)`,
    ),
    start: db.prepare("UPDATE export_jobs SET status = 'running', pid = ?, output_path = ?, updated_at = ? WHERE id = ?"),
    progress: db.prepare('UPDATE export_jobs SET progress = ?, updated_at = ? WHERE id = ?'),
    end: db.prepare('UPDATE export_jobs SET status = ?, error = ?, export_id = ?, progress = ?, pid = NULL, updated_at = ? WHERE id = ?'),
    active: db.prepare<[string], JobRow>(
      "SELECT * FROM export_jobs WHERE document_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC, rowid DESC LIMIT 1",
    ),
    unfinished: db.prepare<[], JobRow>("SELECT * FROM export_jobs WHERE status IN ('queued', 'running')"),
    prune: db.prepare("DELETE FROM export_jobs WHERE status IN ('succeeded', 'failed', 'canceled') AND updated_at < ?"),
  };

  function row(id: string): JobRow {
    const found = q.get.get(id);
    if (!found) throw new IpcError('job_not_found', 'That export no longer exists.');
    return found;
  }

  function publish(id: string): ExportJob {
    const job = toJob(row(id));
    events.emit('export:progress', { job });
    statusChanged();
    return job;
  }

  function removeFiles(entry: Entry): void {
    for (const file of [entry.outputPath, entry.layerPath]) rmSync(file, { force: true });
  }

  /** Records how the job ended, deletes its files and lets the next one run. */
  function end(entry: Entry, status: Exclude<ExportJobStatus, 'queued' | 'running'>, error: string | null, exportId: string | null = null): void {
    removeFiles(entry);
    entries.delete(entry.id);
    if (current === entry) current = null;
    if (closed) return;
    const progress = status === 'succeeded' ? 1 : Math.min(1, Math.max(0, row(entry.id).progress));
    q.end.run(status, error, exportId, progress, stamp(), entry.id);
    entry.settle(publish(entry.id));
    pump();
  }

  function pump(): void {
    if (closed || current) return;
    const next = queue.shift();
    if (!next) return;
    current = next;
    void run(next);
  }

  async function run(entry: Entry): Promise<void> {
    const { input } = entry;
    const tools = await binaries();
    if (closed || entry.canceled) return end(entry, 'canceled', EXPORT_CANCELED);
    if (!tools) return end(entry, 'failed', 'Video export needs FFmpeg. Install it with Homebrew: brew install ffmpeg');
    if (!existsSync(input.sourcePath)) return end(entry, 'failed', 'The video file is missing. Add it again from Write Post.');

    const args = buildExportArgs({
      source: input.sourcePath,
      layer: entry.layerPath,
      output: entry.outputPath,
      info: input.info,
      composition: input.composition,
      layout: exportLayout(input.composition),
      encoder: tools.encoder,
      realtime,
    });
    const video = input.composition.video!;
    const durationMs = video.trimEndMs - video.trimStartMs;

    let stderr = '';
    let pending = '';
    const child = spawn(tools.ffmpeg, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    entry.child = child;
    entry.phase = 'encoding';
    if (child.pid) {
      // Below the UI: libx264 uses every core, and the Studio keeps playing video.
      try {
        setPriority(child.pid, 10);
      } catch {
        // best effort
      }
    }
    q.start.run(child.pid ?? null, `${entry.id}.mp4`, stamp(), entry.id);
    publish(entry.id);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const progress = progressFromLine(pending.slice(0, newline), durationMs);
        pending = pending.slice(newline + 1);
        if (progress === null || closed || entry.canceled) continue;
        q.progress.run(progress, stamp(), entry.id);
        publish(entry.id);
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL);
    });

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve) => {
      child.once('error', (error) => resolve({ code: null, signal: null, error }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    entry.child = null;
    if (closed) return;

    // A cancel that raced a clean exit still wins: the output is thrown away.
    if (entry.canceled) return end(entry, 'canceled', EXPORT_CANCELED);
    if (exit.code !== 0) {
      log.warn('studio: ffmpeg export failed', entry.id, exit.error?.message ?? `exit ${exit.code ?? exit.signal}`, stderr);
      return end(entry, 'failed', errorMessage(stderr));
    }

    entry.phase = 'finishing';
    try {
      const exportId = await serialize(() =>
        finish({ documentId: input.documentId, draftId: input.draftId, openedFromAttachmentId: input.openedFromAttachmentId, output: entry.outputPath, sourceName: input.sourceName }),
      );
      end(entry, 'succeeded', null, exportId);
    } catch (err) {
      if (!(err instanceof IpcError)) log.error('studio: storing the export failed', entry.id, err);
      end(entry, 'failed', err instanceof IpcError ? err.message : EXPORT_FAILED);
    }
  }

  /** Kills `pid` only if it is still the FFmpeg writing `output` (pids get reused). */
  async function killOrphan(pid: number, output: string): Promise<void> {
    try {
      const { stdout } = await runTool('ps', ['-p', String(pid), '-o', 'args='], { timeoutMs: 2000 });
      if (!stdout.includes(output)) return;
      process.kill(pid, 'SIGKILL');
      log.info('studio: killed an export left from the last run', pid);
    } catch {
      // not running any more
    }
  }

  return {
    async init() {
      for (const stale of q.unfinished.all()) {
        if (stale.status === 'running' && stale.pid && stale.output_path) await killOrphan(stale.pid, join(paths.tmp, stale.output_path));
        q.end.run('failed', EXPORT_INTERRUPTED, null, Math.min(1, Math.max(0, stale.progress)), stamp(), stale.id);
      }
      const { changes } = q.prune.run(new Date(now().getTime() - JOB_GC_AGE_MS).toISOString());
      if (changes > 0) log.info(`studio: pruned ${changes} finished export job(s)`);
    },

    async enqueue(input) {
      if (closed) throw new IpcError('quitting', 'xBot is quitting.');
      const { layer, ...rest } = input;
      const id = randomUUID();
      const layerPath = join(paths.tmp, `${id}.layer.png`);
      await writeFile(layerPath, layer, { flag: 'wx' });
      let settle!: (job: ExportJob) => void;
      const settled = new Promise<ExportJob>((resolve) => {
        settle = resolve;
      });
      const entry: Entry = { id, input: rest, layerPath, outputPath: join(paths.tmp, `${id}.mp4`), phase: 'queued', child: null, canceled: false, settled, settle };
      const at = stamp();
      q.insert.run(id, input.documentId, input.draftId, at, at);
      entries.set(id, entry);
      queue.push(entry);
      const job = publish(id);
      pump();
      return job;
    },

    async cancel(jobId) {
      const entry = entries.get(jobId);
      if (!entry) return toJob(row(jobId)); // already finished
      if (entry.phase === 'finishing') return entry.settled; // the MP4 is being attached: too late to stop
      entry.canceled = true;
      if (entry.phase === 'queued') {
        const index = queue.indexOf(entry);
        if (index >= 0) {
          queue.splice(index, 1);
          end(entry, 'canceled', EXPORT_CANCELED);
        }
        // else `run` is about to start it and sees `canceled`.
      } else if (entry.child) {
        const child = entry.child;
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS);
        void entry.settled.finally(() => clearTimeout(timer));
      }
      return entry.settled;
    },

    get: (jobId) => toJob(row(jobId)),

    activeFor(documentId) {
      const found = q.active.get(documentId);
      return found ? toJob(found) : null;
    },

    activity() {
      const running = current ? toJob(row(current.id)) : null;
      return { running, queued: queue.length };
    },

    dispose() {
      if (closed) return;
      const at = stamp();
      for (const entry of entries.values()) {
        entry.child?.kill('SIGKILL');
        removeFiles(entry);
        q.end.run('canceled', EXPORT_INTERRUPTED, null, Math.min(1, Math.max(0, row(entry.id).progress)), at, entry.id);
      }
      closed = true;
      entries.clear();
      queue.length = 0;
      current = null;
    },
  };
}
