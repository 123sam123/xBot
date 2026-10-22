import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { xChannels } from '../../src/shared/contracts/x.channels';
import type { PublishJob } from '../../src/shared/contracts/x';
import { createIpcHandler, type IpcEventLike } from '../../src/main/ipc/core';
import { createMediaService } from '../../src/main/services/media/service';
import { createXHandlers } from '../../src/main/services/x/handlers';
import { hang, json, setup, type Harness } from './x-harness';

// SPEC §22 "Duplicate posting prevention", "Uncertain remote outcomes" and "X
// account isolation", plus §17's validation, against a fake X API: fetch is
// injected and nothing touches the network.

const DAY_MS = 24 * 60 * 60 * 1000;
const trustedEvent: IpcEventLike = { sender: { id: 1 }, senderFrame: { url: 'file:///app/out/renderer/composer/index.html', parent: null } };

let h: Harness;
afterEach(() => h?.close());

function ipc(channel: string) {
  const entry = createXHandlers(h.service).find((e) => e.channel === channel)!;
  return createIpcHandler({ channel, schema: entry.schema, fn: entry.fn, trust: () => true, log: h.log });
}

function payloadFor(text?: string) {
  const draft = h.drafts.getCurrent();
  if (text !== undefined) h.drafts.update(draft.id, text);
  const saved = h.drafts.get(draft.id);
  return { draftId: saved.id, text: saved.text, attachmentIds: saved.attachments.map((a) => a.id) };
}

const jobs = () => h.db.prepare('SELECT COUNT(*) FROM publish_jobs').pluck().get() as number;
const status = (id: string) => h.db.prepare('SELECT status FROM publish_jobs WHERE id = ?').pluck().get(id) as string;

async function postAndSettle(text?: string): Promise<PublishJob> {
  const job = await h.service.post(payloadFor(text));
  await h.service.publisher.idle();
  return h.service.openJobs().find((j) => j.id === job.id) ?? job;
}

describe('duplicate', () => {
  it('5 rapid Post clicks produce 1 publish_jobs row and 1 create call', async () => {
    h = setup();
    await h.connect('builder');
    const post = ipc(xChannels.post);
    const payload = payloadFor('Shipped the X publisher today.');

    const results = await Promise.all(Array.from({ length: 5 }, () => post(trustedEvent, payload)));
    await h.service.publisher.idle();

    expect(results.every((r) => r.ok)).toBe(true);
    const ids = new Set(results.map((r) => (r.ok ? (r.data as PublishJob).id : null)));
    expect(ids.size).toBe(1);
    expect(jobs()).toBe(1);
    expect(h.api.requests('POST /2/tweets')).toHaveLength(1);
    const [id] = ids;
    expect(status(id!)).toBe('published');

    // A sixth click after success returns the posted job instead of posting again.
    const again = await post(trustedEvent, payload);
    expect(again.ok && (again.data as PublishJob).id).toBe(id);
    await h.service.publisher.idle();
    expect(h.api.requests('POST /2/tweets')).toHaveLength(1);
  });

  it('lets SQL refuse a second active job for the same draft', async () => {
    h = setup();
    await h.connect('builder');
    h.api.on('POST /2/tweets', (_req, init) => hang(init));
    const job = await h.service.post(payloadFor('One job only.'));
    const row = h.db.prepare('SELECT * FROM publish_jobs WHERE id = ?').get(job.id) as Record<string, unknown>;
    expect(() =>
      h.db
        .prepare(
          `INSERT INTO publish_jobs (id, draft_id, account_id, account_x_user_id, account_handle, idempotency_key, frozen_text, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        )
        .run(randomUUID(), row.draft_id, row.account_id, row.account_x_user_id, row.account_handle, 'another-key', 'x', 'now', 'now'),
    ).toThrow(/UNIQUE/);
    await h.service.publisher.idle();
  });
});

describe('uncertain outcome', () => {
  it('times out without retrying, then reconciliation finds the t.co-rewritten text post', async () => {
    h = setup();
    await h.connect('builder');
    let delivered: string | null = null;
    // X received the post but the answer never arrives.
    h.api.on('POST /2/tweets', (req, init) => {
      const body = req.json as { text: string };
      delivered = h.api.record(req.token, body.text, []).id;
      return hang(init);
    });
    const job = await postAndSettle('Tiny tool for tidy screenshots & more: https://example.com/tool');

    expect(job.status).toBe('needs_reconciliation');
    expect(job.attempts).toBe(1);
    expect(job.uncertain).toBe(true);
    expect(h.api.requests('POST /2/tweets')).toHaveLength(1);

    const result = await h.service.reconcile(job.id);
    expect(result.found).toBe(true);
    expect(result.job.status).toBe('published');
    expect(result.job.remotePostId).toBe(delivered);
    expect(h.db.prepare('SELECT remote_post_id FROM publish_jobs WHERE id = ?').pluck().get(job.id)).toBe(delivered);
    expect(result.job.remoteUrl).toBe(`https://x.com/i/web/status/${delivered}`);
    expect(h.emitted.some((e) => e.name === 'post:published')).toBe(true);
    expect(h.api.requests('POST /2/tweets')).toHaveLength(1);
  });

  it('finds a media post by its media ids', async () => {
    h = setup();
    await h.connect('builder');
    await h.addImages(1);
    let delivered: string | null = null;
    h.api.on('POST /2/tweets', (req, init) => {
      const body = req.json as { text: string; media: { media_ids: string[] } };
      delivered = h.api.record(req.token, body.text, body.media.media_ids).id;
      return hang(init);
    });
    const job = await postAndSettle('Screenshot attached.');
    expect(job.status).toBe('needs_reconciliation');
    const result = await h.service.reconcile(job.id);
    expect(result).toMatchObject({ found: true, job: { status: 'published', remotePostId: delivered } });
  });

  it('a miss leaves the job open and sends no create', async () => {
    h = setup();
    await h.connect('builder');
    h.api.on('POST /2/tweets', (_req, init) => hang(init));
    const job = await postAndSettle('Never reached X.');
    const result = await h.service.reconcile(job.id);
    expect(result.found).toBe(false);
    expect(status(job.id)).toBe('needs_reconciliation');
    expect(h.api.requests('POST /2/tweets')).toHaveLength(1);
  });

  it('Retry post looks on X first; a 429 keeps it uncertain; the next Retry finds it and sends nothing', async () => {
    h = setup();
    await h.connect('builder');
    let creates = 0;
    h.api.on('POST /2/tweets', (req, init) => {
      creates += 1;
      if (creates === 1) {
        h.api.record(req.token, (req.json as { text: string }).text, []);
        h.api.timeline.length = 0; // not visible on the timeline yet (X lags)
        return hang(init);
      }
      return json(429, { title: 'Too Many Requests', detail: 'Too Many Requests' }, { 'x-rate-limit-reset': String(Math.floor(h.clock.now / 1000) + 1) });
    });
    const job = await postAndSettle('Lagging timeline.');
    expect(job.status).toBe('needs_reconciliation');

    const retried = await h.service.retryJob(job.id);
    expect(retried.status).toBe('needs_reconciliation'); // a definitive failure can't clear an earlier uncertain attempt
    expect(retried.error?.code).toBe('x_rate_limited');
    expect(h.api.requests('GET /2/users/*')).toHaveLength(1);
    expect(creates).toBe(2);

    // Now X shows the first attempt's post.
    h.api.record(h.api.requests('POST /2/tweets')[0]!.token, 'Lagging timeline.', []);
    h.clock.now += 2000; // past the rate-limit reset
    const final = await h.service.retryJob(job.id);
    expect(final.status).toBe('published');
    expect(creates).toBe(2);
  });

  it('a relaunch moves an in-flight create to needs_reconciliation and an unfinished upload to failed', async () => {
    h = setup();
    await h.connect('builder');
    h.api.on('POST /2/tweets', (_req, init) => hang(init));
    const sent = await h.service.post(payloadFor('In flight when xBot quit.'));
    // Let the runner reach the create, then quit before X answers.
    while (status(sent.id) !== 'publishing') await new Promise((r) => setTimeout(r, 1));
    h.service.dispose();
    await new Promise((r) => setTimeout(r, 5));
    expect(status(sent.id)).toBe('publishing'); // the abort wrote nothing

    h.drafts.startNew();
    const other = h.drafts.getCurrent();
    h.drafts.update(other.id, 'Still uploading when xBot quit.');
    h.db.prepare("UPDATE publish_jobs SET status = 'uploading' WHERE id = ?").run(sent.id);
    h.db
      .prepare(
        `INSERT INTO publish_jobs (id, draft_id, account_id, account_x_user_id, account_handle, idempotency_key, frozen_text, status, created_at, updated_at)
         SELECT ?, ?, account_id, account_x_user_id, account_handle, 'k2', 'Still uploading', 'uploading', created_at, updated_at FROM publish_jobs WHERE id = ?`,
      )
      .run(randomUUID(), other.id, sent.id);
    h.db.prepare("UPDATE publish_jobs SET status = 'publishing' WHERE id = ?").run(sent.id);

    const relaunched = h.relaunch();
    const open = relaunched.openJobs();
    expect(open.find((j) => j.id === sent.id)).toMatchObject({ status: 'needs_reconciliation', uncertain: true });
    expect(open.find((j) => j.id !== sent.id)).toMatchObject({ status: 'failed', error: { code: 'x_interrupted' } });
    expect(h.api.requests('POST /2/tweets')).toHaveLength(1);
    relaunched.dispose();
  });
});

describe('isolation', () => {
  it('a job finishes on its own account after a switch; disconnecting A deletes only A', async () => {
    h = setup();
    const a = await h.connect('alice', { access: 'token-A' });
    const b = await h.connect('bob', { access: 'token-B' });
    h.service.switchAccount(a);
    await h.addImages(2);

    let switched = false;
    h.api.on('POST /2/media/upload/:id/append', (req) => {
      if (!switched) {
        switched = true;
        h.service.switchAccount(b); // mid-job
      }
      return json(200, { data: {} });
    });
    const jobA = await postAndSettle('From Alice.');
    expect(jobA.status).toBe('published');
    expect(jobA.accountHandle).toBe('alice');
    const firstB = h.api.log.length;
    expect(h.api.log.filter((r) => r.token !== null).every((r) => r.token === 'token-A')).toBe(true);

    h.drafts.startNew();
    const jobB = await postAndSettle('From Bob.');
    expect(jobB.status).toBe('published');
    expect(jobB.accountHandle).toBe('bob');
    const bRequests = h.api.log.slice(firstB);
    expect(bRequests.length).toBeGreaterThan(0);
    expect(bRequests.every((r) => r.token === 'token-B')).toBe(true);

    const blob = (id: string) => h.db.prepare('SELECT token_blob FROM x_accounts WHERE id = ?').pluck().get(id) as Buffer | undefined;
    const bBefore = Buffer.from(blob(b)!);
    await h.service.disconnect(a);
    expect(blob(a)).toBeUndefined();
    expect(Buffer.compare(blob(b)!, bBefore)).toBe(0);
    expect(h.service.state().accounts.map((acc) => acc.handle)).toEqual(['bob']);
  });

  it('refuses to disconnect an account whose post is still open', async () => {
    h = setup();
    const a = await h.connect('alice');
    h.api.on('POST /2/tweets', (_req, init) => hang(init));
    await postAndSettle('Uncertain.');
    await expect(h.service.disconnect(a)).rejects.toMatchObject({ code: 'x_account_busy' });
    expect(h.service.state().accounts).toHaveLength(1);
  });
});

describe('validation', () => {
  it('blocks 281 weighted characters, 5 images, a video with an image, and a 6 MB PNG before any upload', async () => {
    h = setup();
    await h.connect('builder');
    const post = ipc(xChannels.post);
    const expectBlocked = async (code: string) => {
      const result = await post(trustedEvent, payloadFor());
      expect(result).toMatchObject({ ok: false, error: { code } });
    };

    payloadFor('a'.repeat(281));
    await expectBlocked('x_text_too_long');

    payloadFor('Five screenshots.');
    await h.addImages(5);
    await expectBlocked('x_too_many_media');

    // Video and oversized rows are inserted directly: validation reads only the media rows.
    const attachRow = (kind: 'image' | 'video', mime: string, bytes: number) => {
      const id = randomUUID();
      const ext = kind === 'video' ? 'mp4' : 'png';
      h.db
        .prepare(
          `INSERT INTO media (id, kind, path, mime, width, height, duration_ms, bytes, sha256, thumb_path, original_name, created_at)
           VALUES (?, ?, ?, ?, 10, 10, NULL, ?, ?, NULL, ?, ?)`,
        )
        .run(id, kind, `${id}.${ext}`, mime, bytes, id, `${kind}.${ext}`, new Date().toISOString());
      h.drafts.attach(h.drafts.getCurrent().id, [id]);
    };

    h.drafts.startNew();
    payloadFor('A clip and a screenshot.');
    await h.addImages(1);
    attachRow('video', 'video/mp4', 1_000_000);
    await expectBlocked('x_media_mix');

    h.drafts.startNew();
    payloadFor('A big screenshot.');
    attachRow('image', 'image/png', 6 * 1024 * 1024);
    await expectBlocked('x_media_too_large');

    expect(h.api.log).toHaveLength(0);
    expect(jobs()).toBe(0);
  });

  it('refuses a draft whose saved text differs from what the composer showed', async () => {
    h = setup();
    await h.connect('builder');
    const payload = payloadFor('Saved text.');
    await expect(h.service.post({ ...payload, text: 'Unsaved text.' })).rejects.toMatchObject({ code: 'draft_changed' });
    expect(jobs()).toBe(0);
  });
});

describe('errors and recovery', () => {
  it('maps a 429 to "rate limited until" and blocks Retry until then', async () => {
    h = setup();
    await h.connect('builder');
    const reset = Math.floor(h.clock.now / 1000) + 15 * 60;
    h.api.on('POST /2/tweets', () => json(429, { title: 'Too Many Requests', detail: 'Too Many Requests' }, { 'x-rate-limit-reset': String(reset) }));
    const job = await postAndSettle('Rate limited.');
    expect(job.status).toBe('failed');
    expect(job.error).toMatchObject({ code: 'x_rate_limited', resetAt: new Date(reset * 1000).toISOString() });
    expect(job.error?.message).toMatch(/until \d\d:\d\d/);
    await expect(h.service.retryJob(job.id)).rejects.toMatchObject({ code: 'x_rate_limited' });
  });

  it('refreshes once on a 401 and sends one more create', async () => {
    h = setup();
    await h.connect('builder', { access: 'stale-token', refresh: 'refresh-1' });
    let first = true;
    h.api.on('POST /2/tweets', (req) => {
      if (first) {
        first = false;
        return json(401, { title: 'Unauthorized', detail: 'Unauthorized' });
      }
      const post = h.api.record(req.token, (req.json as { text: string }).text, []);
      return json(201, { data: { id: post.id, text: post.text } });
    });
    h.api.on('POST /2/oauth2/token', () => {
      h.api.users.set('fresh-token', h.api.users.get('stale-token')!);
      return json(200, { token_type: 'bearer', access_token: 'fresh-token', refresh_token: 'refresh-2', expires_in: 7200, scope: 'tweet.read' });
    });
    const job = await postAndSettle('After a refresh.');
    expect(job.status).toBe('published');
    expect(job.attempts).toBe(2);
    expect(h.api.requests('POST /2/tweets').map((r) => r.token)).toEqual(['stale-token', 'fresh-token']);
    expect(h.api.requests('POST /2/oauth2/token')[0]!.form?.get('client_id')).toBe('test-client-id-123');
  });

  it('fails a first-attempt duplicate-content 403 as x_duplicate', async () => {
    h = setup();
    await h.connect('builder');
    h.api.on('POST /2/tweets', () =>
      json(403, { title: 'Forbidden', detail: 'You are not allowed to create a Tweet with duplicate content.', type: 'about:blank', status: 403 }),
    );
    const job = await postAndSettle('Said this before.');
    expect(job).toMatchObject({ status: 'failed', error: { code: 'x_duplicate' } });
  });

  it('maps a 402 to the credits message, never as a reconnect', async () => {
    h = setup();
    await h.connect('builder');
    h.api.on('POST /2/tweets', () => json(402, { title: 'Payment Required', detail: 'Your enrolled account does not have any credits.' }));
    const job = await postAndSettle('Out of credits.');
    expect(job).toMatchObject({ status: 'failed', error: { code: 'x_credits' } });
  });

  it('cancel wins against an upload in progress, and the create is never sent', async () => {
    h = setup();
    await h.connect('builder');
    await h.addImages(1);
    let jobId = '';
    h.api.on('POST /2/media/upload/:id/append', () => {
      h.service.cancelJob(jobId);
      return json(200, { data: {} });
    });
    const job = await h.service.post(payloadFor('Canceled.'));
    jobId = job.id;
    await h.service.publisher.idle();
    expect(status(job.id)).toBe('canceled');
    expect(h.api.requests('POST /2/tweets')).toHaveLength(0);
  });

  it('a Retry after the uploaded media expired uploads it again', async () => {
    h = setup();
    await h.connect('builder');
    await h.addImages(1);
    h.api.on('POST /2/tweets', (_req, init) => hang(init));
    const job = await postAndSettle('Media expires.');
    expect(job.status).toBe('needs_reconciliation');
    h.api.overrides.delete('POST /2/tweets');
    h.clock.now += DAY_MS; // X's upload sessions last 24 h
    const before = h.api.requests('POST /2/media/upload/initialize').length;
    await h.service.retryJob(job.id);
    await h.service.publisher.idle();
    expect(h.api.requests('POST /2/media/upload/initialize').length).toBe(before + 1);
    expect(status(job.id)).toBe('published');
    expect(h.api.requests('POST /2/tweets')).toHaveLength(2);
  });

  it('keeps a queued job’s media through the startup GC a day later', async () => {
    h = setup();
    await h.connect('builder');
    await h.addImages(1);
    h.api.on('POST /2/media/upload/initialize', () => json(503, { detail: 'Service Unavailable' }));
    const job = await postAndSettle('Failed upload, kept media.');
    expect(job.status).toBe('failed');
    h.drafts.startNew(); // the draft no longer holds the media; the job still does
    const mediaId = job.mediaIds[0]!;
    h.db.prepare('DELETE FROM draft_attachments WHERE media_id = ?').run(mediaId);
    const later = createMediaService({ db: h.db, paths: h.paths, log: h.log, tools: { makeThumbnail: async () => false }, drafts: h.drafts, now: () => Date.now() + 2 * DAY_MS });
    await later.init();
    expect(h.db.prepare('SELECT COUNT(*) FROM media WHERE id = ?').pluck().get(mediaId)).toBe(1);

    // Dismissing the failed job releases it.
    h.service.dismissJob(job.id);
    expect(h.service.openJobs().find((j) => j.id === job.id)).toBeUndefined();
    await later.init();
    expect(h.db.prepare('SELECT COUNT(*) FROM media WHERE id = ?').pluck().get(mediaId)).toBe(0);
    later.dispose();
  });

  it('never writes a token into the log', async () => {
    h = setup();
    await h.connect('builder', { access: 'secret-access-token', refresh: 'secret-refresh-token' });
    h.api.on('POST /2/tweets', () => json(500, { detail: 'Internal error' }));
    await postAndSettle('Logged failure.');
    h.api.on('POST /2/oauth2/token', () => json(400, { error: 'invalid_grant', error_description: 'Value passed for the token was invalid.' }));
    h.clock.now += 3 * 60 * 60 * 1000;
    await expect(h.service.accounts.accessToken(h.service.accounts.active()!.id)).rejects.toMatchObject({ code: 'x_reconnect' });
    const everything = h.log.lines.join('\n') + JSON.stringify(h.emitted);
    expect(everything).not.toContain('secret-access-token');
    expect(everything).not.toContain('secret-refresh-token');
  });
});
