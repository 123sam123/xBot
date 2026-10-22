import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledMigrations, openDatabase, type Db } from '../../src/main/db';
import { migrate } from '../../src/main/db/migrate';
import type { Logger } from '../../src/main/log';
import { appPaths, prepareUserData, type AppPaths } from '../../src/main/paths';
import { createDraftsService, type DraftsService } from '../../src/main/services/drafts/service';
import { createMediaService, type MediaService, type MediaTools } from '../../src/main/services/media/service';
import type { ServiceContext } from '../../src/main/services/types';
import type { FetchLike, TokenSet } from '../../src/main/services/x/api';
import type { Loopback, LoopbackOptions } from '../../src/main/services/x/loopback';
import { SCOPES } from '../../src/main/services/x/oauth';
import { createXService, type XService, type XServiceDeps } from '../../src/main/services/x/service';
import { createVault, type SafeStorageLike } from '../../src/main/services/x/vault';

// Shared fixtures for the X tests: a fake X API (an injected fetch; nothing
// touches the network), a fake safeStorage, and T3's real drafts and media
// services on a temporary database. Not a test file itself.

export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const fakeTools: MediaTools = {
  async makeThumbnail(_file, _info, out) {
    writeFileSync(out, ONE_PIXEL_PNG);
    return true;
  },
};

export interface LoggedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  /** The bearer token sent, or null. */
  token: string | null;
  form: URLSearchParams | null;
  json: unknown;
}

export interface FakePost {
  id: string;
  text: string;
  created_at: string;
  mediaKeys: string[];
  userId: string;
}

type Route = (req: LoggedRequest, init: RequestInit) => Response | Promise<Response>;

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A request that never answers until it is aborted (by its timeout, or a quit). */
export function hang(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

/**
 * A stand-in for api.x.com. Every request is logged with its bearer token.
 * Tokens map to X users; posts land on that user's timeline the way X shows
 * them (links as t.co, `&` escaped, a media link appended).
 */
export class FakeX {
  readonly log: LoggedRequest[] = [];
  readonly timeline: FakePost[] = [];
  readonly users = new Map<string, { id: string; username: string; name: string }>();
  /** Refresh token → user; each refresh rotates it (single use), as X does. */
  readonly refreshTokens = new Map<string, { id: string; username: string; name: string }>();
  readonly overrides = new Map<string, Route>();
  /** The fake's clock, for post times; setup() ties it to the harness clock. */
  now: () => number = Date.now;
  private seq = 1_880_000_000_000_000_000n;
  private uploads = new Map<string, { mediaType: string; category: string; statusChecks: number }>();

  nextId(): string {
    this.seq += 1n;
    return this.seq.toString();
  }

  on(route: string, handler: Route): void {
    this.overrides.set(route, handler);
  }

  requests(route: string): LoggedRequest[] {
    const [method, path] = route.split(' ');
    return this.log.filter((r) => r.method === method && (path!.endsWith('*') ? r.path.startsWith(path!.slice(0, -1)) : r.path === path));
  }

  /** What X would store for a post made through the API. */
  record(token: string | null, text: string, mediaIds: readonly string[]): FakePost {
    const user = token ? this.users.get(token) : undefined;
    const tco = text.replace(/https?:\/\/\S+/g, () => `https://t.co/${randomUUID().replaceAll('-', '').slice(0, 10)}`).replaceAll('&', '&amp;');
    const post: FakePost = {
      id: this.nextId(),
      text: mediaIds.length > 0 ? `${tco} https://t.co/media${mediaIds.length}`.trim() : tco,
      created_at: new Date(this.now()).toISOString(),
      mediaKeys: mediaIds.map((id) => `3_${id}`),
      userId: user?.id ?? 'unknown',
    };
    this.timeline.unshift(post);
    return post;
  }

  readonly fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const auth = headers.Authorization ?? null;
    const contentType = headers['Content-Type'] ?? '';
    const body = typeof init.body === 'string' ? init.body : null;
    const req: LoggedRequest = {
      method: init.method ?? 'GET',
      path: u.pathname,
      query: u.searchParams,
      token: auth?.startsWith('Bearer ') ? auth.slice(7) : null,
      form: contentType.startsWith('application/x-www-form-urlencoded') && body !== null ? new URLSearchParams(body) : null,
      json: contentType === 'application/json' && body !== null ? JSON.parse(body) : null,
    };
    this.log.push(req);
    // Long numeric segments (X ids) become :id; `/2` (the API version) stays.
    const key = `${req.method} ${req.path.replace(/\/\d{3,}(?=\/|$)/g, '/:id')}`;
    const override = this.overrides.get(key);
    if (override) return override(req, init);
    return this.defaultRoute(key, req);
  };

  private defaultRoute(key: string, req: LoggedRequest): Response {
    const user = req.token ? this.users.get(req.token) : undefined;
    switch (key) {
      case 'POST /2/media/upload/initialize': {
        if (!user) return json(401, { title: 'Unauthorized', detail: 'Unauthorized', type: 'about:blank', status: 401 });
        const id = this.nextId();
        const body = req.json as { media_type: string; media_category: string };
        this.uploads.set(id, { mediaType: body.media_type, category: body.media_category, statusChecks: 0 });
        return json(200, { data: { id, media_key: `3_${id}`, expires_after_secs: 86_400 } });
      }
      case 'POST /2/media/upload/:id/append':
        return user ? json(200, { data: { expires_at: 0 } }) : json(401, { detail: 'Unauthorized' });
      case 'POST /2/media/upload/:id/finalize': {
        const id = req.path.split('/')[4]!;
        const upload = this.uploads.get(id);
        const processing = upload?.category === 'tweet_video' ? { processing_info: { state: 'pending', check_after_secs: 1 } } : {};
        return json(200, { data: { id, media_key: `3_${id}`, expires_after_secs: 86_400, ...processing } });
      }
      case 'GET /2/media/upload': {
        const id = req.query.get('media_id')!;
        const upload = this.uploads.get(id)!;
        upload.statusChecks += 1;
        const state = upload.statusChecks >= 2 ? 'succeeded' : 'in_progress';
        return json(200, { data: { id, processing_info: { state, check_after_secs: 1, progress_percent: state === 'succeeded' ? 100 : 40 } } });
      }
      case 'POST /2/tweets': {
        if (!user) return json(401, { title: 'Unauthorized', detail: 'Unauthorized', type: 'about:blank', status: 401 });
        const body = req.json as { text: string; media?: { media_ids: string[] } };
        const post = this.record(req.token, body.text, body.media?.media_ids ?? []);
        return json(201, { data: { id: post.id, text: post.text, edit_history_post_ids: [post.id] } });
      }
      case 'GET /2/users/:id/tweets': {
        const userId = req.path.split('/')[3]!;
        const start = req.query.get('start_time');
        const posts = this.timeline.filter((p) => p.userId === userId && (!start || p.created_at >= start));
        return json(200, {
          data: posts.map((p) => ({ id: p.id, text: p.text, created_at: p.created_at, ...(p.mediaKeys.length ? { attachments: { media_keys: p.mediaKeys } } : {}) })),
          meta: { result_count: posts.length },
        });
      }
      case 'GET /2/users/me':
        return user ? json(200, { data: user }) : json(401, { detail: 'Unauthorized' });
      case 'POST /2/oauth2/token': {
        const refresh = req.form?.get('refresh_token');
        const owner = refresh ? this.refreshTokens.get(refresh) : undefined;
        if (req.form?.get('grant_type') !== 'refresh_token' || !refresh || !owner) {
          return json(400, { error: 'invalid_request', error_description: 'Value passed for the token was invalid.' });
        }
        this.refreshTokens.delete(refresh);
        const access = `access-${randomUUID()}`;
        const next = `refresh-${randomUUID()}`;
        this.users.set(access, owner);
        this.refreshTokens.set(next, owner);
        return json(200, { token_type: 'bearer', access_token: access, refresh_token: next, expires_in: 7200, scope: 'tweet.read tweet.write users.read offline.access media.write' });
      }
      case 'POST /2/oauth2/revoke':
        return json(200, { revoked: true });
      default:
        return json(404, { title: 'Not Found', detail: `no fake for ${key}` });
    }
  }
}

/** A stand-in for Electron's safeStorage. Its "ciphertext" is reversible but never the plaintext. */
export function fakeSafeStorage(options: { available?: boolean; backend?: string; failDecrypt?: boolean } = {}): SafeStorageLike {
  const available = options.available ?? true;
  return {
    isEncryptionAvailable: () => available,
    isAsyncEncryptionAvailable: async () => available,
    async encryptStringAsync(plainText) {
      return Buffer.from(`sealed:${Buffer.from(plainText).reverse().toString('base64')}`);
    },
    async decryptStringAsync(encrypted) {
      const text = encrypted.toString();
      if (options.failDecrypt || !text.startsWith('sealed:')) throw new Error('decrypt failed');
      return { result: Buffer.from(text.slice(7), 'base64').reverse().toString(), shouldReEncrypt: false };
    },
    getSelectedStorageBackend: () => options.backend ?? 'gnome_libsecret',
  };
}

export interface CapturedLog extends Logger {
  lines: string[];
}

export function captureLog(): CapturedLog {
  const lines: string[] = [];
  const write = (level: string) => (message: string, ...details: unknown[]) =>
    lines.push([level, message, ...details.map((d) => (d instanceof Error ? (d.stack ?? d.message) : typeof d === 'string' ? d : JSON.stringify(d)))].join(' '));
  return { lines, info: write('info'), warn: write('warn'), error: write('error') };
}

export interface Harness {
  db: Db;
  paths: AppPaths;
  drafts: DraftsService;
  media: MediaService;
  api: FakeX;
  service: XService;
  log: CapturedLog;
  emitted: { name: string; payload: unknown }[];
  opened: string[];
  clock: { now: number };
  sources: string;
  /** Imports distinct 1-px PNGs into the current draft and returns it. */
  addImages(count: number): Promise<void>;
  /** Connects an account the way a finished sign-in does, with a far-off token expiry unless given. */
  connect(handle: string, opts?: { access?: string; refresh?: string; expiresInMs?: number }): Promise<string>;
  /** A fresh service on the same database (a relaunch). */
  relaunch(overrides?: Partial<XServiceDeps>): XService;
  close(): void;
}

export function setup(overrides: Partial<XServiceDeps> & { safeStorage?: SafeStorageLike; platform?: string } = {}): Harness {
  const userData = mkdtempSync(join(tmpdir(), 'xbot-x-'));
  const sources = mkdtempSync(join(tmpdir(), 'xbot-x-src-'));
  const paths = appPaths(userData);
  prepareUserData(paths);
  mkdirSync(join(paths.media, 'thumbs'), { recursive: true }); // what media.init() does at startup
  const db = openDatabase(paths.db);
  migrate(db, bundledMigrations());
  const events = new EventEmitter() as ServiceContext['events'];
  const drafts = createDraftsService(db, { events });
  const log = captureLog();
  const media = createMediaService({ db, paths, log, tools: fakeTools, drafts });
  const api = new FakeX();
  const emitted: Harness['emitted'] = [];
  const opened: string[] = [];
  const clock = { now: Date.now() };
  api.now = () => clock.now;
  const { safeStorage, platform, ...serviceOverrides } = overrides;

  const make = (more: Partial<XServiceDeps> = {}) => {
    const service = createXService({
      db,
      log,
      fetch: api.fetch,
      vault: createVault(safeStorage ?? fakeSafeStorage(), platform ?? 'darwin'),
      drafts,
      mediaRoot: paths.media,
      emit: (name, payload) => emitted.push({ name, payload }),
      config: () => ({ clientId: 'test-client-id-123', port: 0 }),
      openBrowser: (url) => opened.push(url),
      now: () => clock.now,
      sleep: async () => {},
      timeouts: { requestMs: 2000, createMs: 60, retryDelayMs: 1, connectMs: 2000 },
      chunkBytes: 32,
      ...serviceOverrides,
      ...more,
    });
    service.init();
    return service;
  };
  const service = make();
  let pngSerial = 0;

  return {
    db,
    paths,
    drafts,
    media,
    api,
    service,
    log,
    emitted,
    opened,
    clock,
    sources,
    async addImages(count) {
      const files = Array.from({ length: count }, () => {
        const name = `shot-${++pngSerial}.png`;
        const path = join(sources, name);
        writeFileSync(path, Buffer.concat([ONE_PIXEL_PNG, Buffer.from(`distinct ${pngSerial} ${randomUUID()}`)]));
        return { name, path };
      });
      const { rejected } = await media.importFiles(drafts.getCurrent().id, files);
      if (rejected.length > 0) throw new Error(`import rejected: ${JSON.stringify(rejected)}`);
    },
    async connect(handle, opts = {}) {
      const access = opts.access ?? `access-${handle}-${randomUUID()}`;
      const userId = String(1000 + api.users.size);
      const user = { id: userId, username: handle, name: handle.toUpperCase() };
      api.users.set(access, user);
      const refresh = opts.refresh ?? `refresh-${handle}-${randomUUID()}`;
      api.refreshTokens.set(refresh, user);
      const tokens: TokenSet = {
        access,
        refresh,
        expiresAt: new Date(clock.now + (opts.expiresInMs ?? 2 * 60 * 60 * 1000)).toISOString(),
        scope: SCOPES.join(' '),
      };
      const row = await service.accounts.save({ xUserId: userId, clientId: 'test-client-id-123', handle, name: handle.toUpperCase(), tokens });
      return row.id;
    },
    relaunch(more) {
      return make(more);
    },
    close() {
      service.dispose();
      media.dispose();
      db.close();
      rmSync(userData, { recursive: true, force: true });
      rmSync(sources, { recursive: true, force: true });
    },
  };
}

/** A loopback stand-in that records what was asked and answers like X's redirect would. */
export function fakeListen(answer: (opts: LoopbackOptions) => Promise<{ kind: 'code'; code: string } | { kind: 'error'; error: string; description: string | null }>) {
  const calls: LoopbackOptions[] = [];
  const listen = async (opts: LoopbackOptions): Promise<Loopback> => {
    calls.push(opts);
    return { port: 47_999, result: answer(opts), close() {} };
  };
  return { calls, listen };
}
