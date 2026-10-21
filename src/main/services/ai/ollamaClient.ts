import { z } from 'zod';
import { isLoopbackEndpoint, isLoopbackRequestUrl, requestBase } from '../../../shared/aiEndpoint';
import { NdjsonError, readNdjson } from './ndjson';

// The only way xBot talks to Ollama (docs/OLLAMA.md). Every request goes to a
// loopback endpoint, refuses redirects, and is bounded by a timeout; every
// response is validated. No `electron` import: unit tests load this module.

export type OllamaErrorCode =
  | 'unreachable'
  | 'timeout'
  | 'aborted'
  | 'preempted'
  | 'redirect_refused'
  | 'http_error'
  | 'bad_response'
  | 'stream_error'
  | 'endpoint_invalid'
  | 'endpoint_proxied'
  | 'remote_refused'
  | 'too_long'
  | 'malformed';

export class OllamaError extends Error {
  constructor(
    readonly code: OllamaErrorCode,
    message: string,
    /** HTTP status, for `http_error`. */
    readonly status?: number,
    /** Ollama's own `error` text, when it sent one. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// Ollama's responses are untrusted input. Loose objects: new fields from a
// newer Ollama never break parsing, but the fields xBot reads are checked.
const remoteFields = { remote_model: z.string().optional(), remote_host: z.string().optional() };

export const versionSchema = z.looseObject({ version: z.string() });
export const statusSchema = z.looseObject({ cloud: z.looseObject({ disabled: z.boolean() }).optional() });
export const tagSchema = z.looseObject({
  name: z.string(),
  model: z.string().optional(),
  size: z.number().nonnegative(),
  digest: z.string(),
  details: z.looseObject({ parameter_size: z.string().optional() }).optional(),
  capabilities: z.array(z.string()).optional(),
  ...remoteFields,
});
export const tagsSchema = z.looseObject({ models: z.array(tagSchema) });
export const showSchema = z.looseObject({
  capabilities: z.array(z.string()).optional(),
  ...remoteFields,
});
export const psModelSchema = z.looseObject({
  name: z.string(),
  digest: z.string(),
  size: z.number().nonnegative(),
  expires_at: z.string().optional(),
  context_length: z.number().int().positive().optional(),
});
export const psSchema = z.looseObject({ models: z.array(psModelSchema) });
export const chatChunkSchema = z.looseObject({
  message: z.looseObject({ content: z.string().optional(), thinking: z.string().optional() }).optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  error: z.string().optional(),
  ...remoteFields,
});
export const pullLineSchema = z.looseObject({
  status: z.string().optional(),
  digest: z.string().optional(),
  total: z.number().nonnegative().optional(),
  completed: z.number().nonnegative().optional(),
  error: z.string().optional(),
});

export type OllamaTag = z.infer<typeof tagSchema>;
export type OllamaShow = z.infer<typeof showSchema>;
export type OllamaPsModel = z.infer<typeof psModelSchema>;
export type ChatChunk = z.infer<typeof chatChunkSchema>;
export type PullLine = z.infer<typeof pullLineSchema>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatBody {
  model: string;
  messages: ChatMessage[];
  format: object;
  keep_alive: string | number;
  think?: boolean;
  options: { num_ctx: number; num_predict: number; temperature: number };
}

/**
 * True when Node would send requests to `host` through a proxy: env proxies
 * are switched on (`NODE_USE_ENV_PROXY` or `--use-env-proxy`), HTTP_PROXY is
 * set, and NO_PROXY does not name the host. xBot then refuses to send.
 */
export function proxyBlocks(env: NodeJS.ProcessEnv, execArgv: readonly string[], host: string): boolean {
  const flag = env.NODE_USE_ENV_PROXY;
  const enabled =
    (flag !== undefined && flag !== '' && flag !== '0') ||
    execArgv.includes('--use-env-proxy') ||
    (env.NODE_OPTIONS ?? '').split(/\s+/).includes('--use-env-proxy');
  const proxy = env.HTTP_PROXY || env.http_proxy;
  if (!enabled || !proxy) return false;
  const bare = host.replace(/^\[|\]$/g, '');
  const entries = (env.NO_PROXY ?? env.no_proxy ?? '').split(/[\s,]+/).filter(Boolean);
  const covered = entries.some((entry) => {
    const name = entry.replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
    return entry === '*' || name === bare || name === host;
  });
  return !covered;
}

interface Linked {
  signal: AbortSignal;
  abort(reason: OllamaError): void;
  /** Restarts the timer that aborts with `idle` after `ms`. */
  touch(ms: number, idle: OllamaError): void;
  dispose(): void;
}

/** One AbortController fed by the caller's signal and typed timers, so an abort's cause is always known. */
function linkSignals(parent: AbortSignal | undefined, timeoutMs: number | undefined, timeout: OllamaError): Linked {
  const controller = new AbortController();
  const abort = (reason: unknown) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onParent = () => abort(parent?.reason instanceof OllamaError ? parent.reason : new OllamaError('aborted', 'Cancelled.'));
  if (parent?.aborted) onParent();
  else parent?.addEventListener('abort', onParent, { once: true });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => abort(timeout), timeoutMs);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    signal: controller.signal,
    abort,
    touch(ms, idle) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort(idle), ms);
    },
    dispose() {
      clearTimeout(timer);
      clearTimeout(idleTimer);
      parent?.removeEventListener('abort', onParent);
    },
  };
}

/** The error to report for a failure while `signal` was in play. */
function classify(err: unknown, signal: AbortSignal): OllamaError {
  if (signal.aborted) {
    return signal.reason instanceof OllamaError ? signal.reason : new OllamaError('aborted', 'Cancelled.');
  }
  if (err instanceof OllamaError) return err;
  if (err instanceof NdjsonError) return new OllamaError('bad_response', err.message);
  return new OllamaError('unreachable', `Could not reach Ollama: ${err instanceof Error ? err.message : String(err)}`);
}

function errorField(text: string): string | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string') {
      return (value as { error: string }).error.slice(0, 500);
    }
  } catch {
    // not JSON
  }
  return undefined;
}

export interface OllamaClientOptions {
  endpoint: string;
  /** Defaults to Node's global fetch, looked up at call time (never Electron's net.fetch). */
  fetch?: FetchLike;
  probeTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  execArgv?: readonly string[];
}

export interface ChatOptions {
  signal?: AbortSignal;
  /** From the request being sent; includes model load and Ollama's own queue. */
  attemptTimeoutMs: number;
  /** Between chunks, once the first chunk has arrived. */
  idleTimeoutMs?: number;
  /** Called per chunk; throwing aborts the request. */
  onChunk(chunk: ChatChunk): void;
}

export interface PullOptions {
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  onLine(line: PullLine): void;
}

export type OllamaClient = ReturnType<typeof createOllamaClient>;

export function createOllamaClient({
  endpoint,
  fetch: fetchImpl = (input, init) => globalThis.fetch(input, init),
  probeTimeoutMs = 3000,
  env = process.env,
  execArgv = process.execArgv,
}: OllamaClientOptions) {
  if (!isLoopbackEndpoint(endpoint)) throw new OllamaError('endpoint_invalid', 'Only a loopback Ollama endpoint is allowed.');
  const base = requestBase(endpoint);
  const host = new URL(base).hostname;

  async function send(path: string, method: 'GET' | 'POST', body: unknown, signal: AbortSignal): Promise<Response> {
    const url = `${base}${path}`;
    // Defence in depth: the base is already loopback, but nothing leaves without this check.
    if (!isLoopbackRequestUrl(url)) throw new OllamaError('endpoint_invalid', 'Refusing a non-loopback request.');
    if (proxyBlocks(env, execArgv, host)) throw new OllamaError('endpoint_proxied', 'A proxy is configured for this process.');
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal,
      });
    } catch (err) {
      throw classify(err, signal);
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      await res.body?.cancel().catch(() => {});
      throw new OllamaError('redirect_refused', `Ollama endpoint answered ${res.status} (redirect); refused.`, res.status);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const detail = errorField(text);
      throw new OllamaError('http_error', `Ollama answered ${res.status}${detail ? `: ${detail}` : ''}`, res.status, detail);
    }
    return res;
  }

  async function probe<S extends z.ZodType>(path: string, schema: S, body?: unknown, parent?: AbortSignal): Promise<z.output<S>> {
    const linked = linkSignals(parent, probeTimeoutMs, new OllamaError('timeout', `Ollama did not answer ${path} in time.`));
    try {
      const res = await send(path, body === undefined ? 'GET' : 'POST', body, linked.signal);
      let json: unknown;
      try {
        json = await res.json();
      } catch (err) {
        if (linked.signal.aborted) throw classify(err, linked.signal);
        throw new OllamaError('bad_response', `${path} did not return JSON.`);
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw new OllamaError('bad_response', `${path} returned an unexpected shape.`);
      return parsed.data;
    } catch (err) {
      throw classify(err, linked.signal);
    } finally {
      linked.dispose();
    }
  }

  async function stream(
    path: string,
    body: unknown,
    linked: Linked,
    idleTimeoutMs: number,
    idle: OllamaError,
    onLine: (value: unknown) => void,
  ): Promise<void> {
    try {
      const res = await send(path, 'POST', body, linked.signal);
      if (!res.body) throw new OllamaError('bad_response', `${path} returned no body.`);
      linked.touch(idleTimeoutMs, idle);
      try {
        await readNdjson(res.body, (value) => {
          linked.touch(idleTimeoutMs, idle);
          try {
            onLine(value);
          } catch (err) {
            // A callback refusing the stream (remote model, size cap) aborts the request too.
            linked.abort(err instanceof OllamaError ? err : new OllamaError('bad_response', String(err)));
            throw err;
          }
        });
      } catch (err) {
        if (linked.signal.aborted || err instanceof OllamaError || err instanceof NdjsonError) throw err;
        // The connection was up and then dropped: Ollama quit or crashed mid-stream.
        throw new OllamaError('stream_error', 'Ollama stopped while sending.');
      }
    } catch (err) {
      throw classify(err, linked.signal);
    } finally {
      linked.dispose();
    }
  }

  return {
    endpoint,
    base,
    version: (signal?: AbortSignal) => probe('/api/version', versionSchema, undefined, signal),
    status: (signal?: AbortSignal) => probe('/api/status', statusSchema, undefined, signal),
    tags: (signal?: AbortSignal) => probe('/api/tags', tagsSchema, undefined, signal),
    show: (model: string, signal?: AbortSignal) => probe('/api/show', showSchema, { model }, signal),
    ps: (signal?: AbortSignal) => probe('/api/ps', psSchema, undefined, signal),

    /** Streams one /api/chat request; resolves on `done:true`. */
    async chat(body: ChatBody, { signal, attemptTimeoutMs, idleTimeoutMs = 30_000, onChunk }: ChatOptions): Promise<void> {
      const linked = linkSignals(signal, attemptTimeoutMs, new OllamaError('timeout', 'Generation took too long.'));
      let done = false;
      await stream(
        '/api/chat',
        { ...body, stream: true, truncate: false },
        linked,
        idleTimeoutMs,
        new OllamaError('timeout', 'Ollama stopped sending.'),
        (value) => {
          const parsed = chatChunkSchema.safeParse(value);
          if (!parsed.success) throw new OllamaError('bad_response', 'Unexpected chat chunk.');
          const chunk = parsed.data;
          if (chunk.error !== undefined) throw new OllamaError('http_error', `Ollama: ${chunk.error}`, 200, chunk.error.slice(0, 500));
          if (chunk.remote_host || chunk.remote_model) {
            throw new OllamaError('remote_refused', 'Ollama answered from a remote model.');
          }
          onChunk(chunk);
          if (chunk.done) done = true;
        },
      );
      if (!done) throw new OllamaError('stream_error', 'Ollama closed the stream before it finished.');
    },

    /** Streams one /api/pull; resolves on `status: "success"`. */
    async pull(model: string, { signal, idleTimeoutMs = 60_000, onLine }: PullOptions): Promise<void> {
      const linked = linkSignals(signal, undefined, new OllamaError('timeout', 'Download timed out.'));
      let success = false;
      await stream('/api/pull', { model, stream: true }, linked, idleTimeoutMs, new OllamaError('timeout', 'The download stalled.'), (value) => {
        const parsed = pullLineSchema.safeParse(value);
        if (!parsed.success) throw new OllamaError('bad_response', 'Unexpected pull line.');
        if (parsed.data.error !== undefined) {
          throw new OllamaError('http_error', `Ollama: ${parsed.data.error}`, 200, parsed.data.error.slice(0, 500));
        }
        onLine(parsed.data);
        if (parsed.data.status === 'success') success = true;
      });
      if (!success) throw new OllamaError('stream_error', 'The download ended before it finished.');
    },
  };
}
