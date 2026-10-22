import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { bundledMigrations, openDatabase, type Db } from '../../../src/main/db';
import { migrate } from '../../../src/main/db/migrate';
import type { Logger } from '../../../src/main/log';
import { createAiService, type AiService, type AiServiceDeps, type AiSettingsSnapshot } from '../../../src/main/services/ai/service';

// A real HTTP server on 127.0.0.1 that answers like Ollama, so the client's
// fetch, redirect handling, NDJSON parsing and aborts run for real.

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
  /** Resolves when the client's socket for this request closes. */
  closed: Promise<number>;
}

export type Route = (req: IncomingMessage, res: ServerResponse, body: unknown) => void;

export interface MockOllama {
  endpoint: string;
  port: number;
  requests: Recorded[];
  routes: Record<string, Route>;
  hits(path: string): Recorded[];
  close(): Promise<void>;
}

export const GEMMA_TAG = {
  name: 'gemma3:4b',
  model: 'gemma3:4b',
  modified_at: '2026-10-20T10:00:00Z',
  size: 3_338_801_804,
  digest: 'a2af6cc3eb7fa8be8504abaf9b04e88f17a119ec3f04a3addf55f92841195f5a',
  details: { format: 'gguf', family: 'gemma3', parameter_size: '4.3B', quantization_level: 'Q4_K_M' },
  capabilities: ['completion'],
};

export const STORY_JSON = JSON.stringify({
  problem_solution: 'Kept forgetting to post what I build, so I made a tiny menu bar app that nudges me.',
  progress_lesson: 'Day one of the menu bar app: drafts autosave now. Lesson: ship the boring part first.',
  funny_observation: 'Spent an hour building a tool to save me five minutes. Worth it? Ask me next week.',
});

export function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

/** Streams `lines` as NDJSON, one every `intervalMs`; `end: false` leaves the response open. */
export function ndjson(res: ServerResponse, lines: unknown[], { intervalMs = 0, end = true } = {}): void {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  let index = 0;
  const next = () => {
    if (res.destroyed) return;
    if (index >= lines.length) {
      if (end) res.end();
      return;
    }
    res.write(`${JSON.stringify(lines[index])}\n`);
    index += 1;
    if (intervalMs > 0) setTimeout(next, intervalMs);
    else next();
  };
  next();
}

/** A streamed chat answer: `content` split into chunks, then `done`. */
export function chatLines(content: string, { chunk = 24, doneReason = 'stop', extra = {} as Record<string, unknown> } = {}): unknown[] {
  const lines: unknown[] = [];
  for (let i = 0; i < content.length; i += chunk) {
    lines.push({ model: 'gemma3:4b', created_at: '2026-10-21T12:00:00Z', message: { role: 'assistant', content: content.slice(i, i + chunk) }, done: false, ...extra });
  }
  lines.push({ model: 'gemma3:4b', created_at: '2026-10-21T12:00:01Z', message: { role: 'assistant', content: '' }, done: true, done_reason: doneReason });
  return lines;
}

export function defaultRoutes(): Record<string, Route> {
  return {
    'GET /api/version': (_req, res) => json(res, { version: '0.31.1' }),
    'GET /api/status': (_req, res) => json(res, { cloud: { disabled: true, source: 'config' } }),
    'GET /api/tags': (_req, res) => json(res, { models: [GEMMA_TAG] }),
    'POST /api/show': (_req, res) =>
      json(res, { capabilities: ['completion'], details: GEMMA_TAG.details, model_info: {}, modified_at: GEMMA_TAG.modified_at }),
    'GET /api/ps': (_req, res) => json(res, { models: [] }),
    'POST /api/chat': (_req, res) => ndjson(res, chatLines(STORY_JSON)),
  };
}

export async function startMockOllama(routes: Record<string, Route> = defaultRoutes()): Promise<MockOllama> {
  const requests: Recorded[] = [];
  const mock = { routes } as MockOllama;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = undefined;
      if (raw !== '') {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const path = (req.url ?? '/').split('?')[0]!;
      const closed = new Promise<number>((resolve) => res.on('close', () => resolve(Date.now())));
      requests.push({ method: req.method ?? 'GET', path, body, closed });
      const route = mock.routes[`${req.method} ${path}`];
      if (route) route(req, res, body);
      else json(res, { error: 'not found' }, 404);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  Object.assign(mock, {
    endpoint: `http://127.0.0.1:${port}`,
    port,
    requests,
    hits: (path: string) => requests.filter((r) => r.path === path),
    close: () =>
      new Promise<void>((resolve) => {
        // Streams that never finish keep sockets open; close them so teardown can't hang.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
  return mock;
}

/** A port that was bound and released: connecting to it is refused. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// ---------- A service wired to a migrated in-memory database ----------

export interface TestService {
  service: AiService;
  db: Db;
  settings: AiSettingsSnapshot;
  events: { name: string; payload: unknown }[];
  close(): void;
}

const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export function makeService(endpoint: string, overrides: Partial<AiServiceDeps> & { settings?: Partial<AiSettingsSnapshot> } = {}): TestService {
  const db = openDatabase(':memory:');
  migrate(db, bundledMigrations());
  const settings: AiSettingsSnapshot = { endpoint, model: null, lowResource: false, timeoutSec: 90, ...overrides.settings };
  const events: { name: string; payload: unknown }[] = [];
  const service = createAiService({
    db,
    getSettings: () => settings,
    setModel: (model) => {
      settings.model = model;
    },
    isPreview: false,
    log: quiet,
    emit: (name, payload) => events.push({ name, payload }),
    totalMemBytes: 16 * 2 ** 30,
    env: {},
    execArgv: [],
    progressIntervalMs: 0,
    ...overrides,
  });
  return {
    service,
    db,
    settings,
    events,
    close() {
      service.dispose();
      db.close();
    },
  };
}
