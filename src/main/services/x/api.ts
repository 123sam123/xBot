import { randomBytes } from 'node:crypto';
import { z } from 'zod';

// The X API as xBot uses it (docs/X.md). No `electron` import: fetch is
// injected (Electron's net.fetch in the app, a fake in tests). Every response
// is parsed with zod, and the only error that leaves this module is XApiError,
// whose message holds X's own words plus the status — never a token, an OAuth
// code, a verifier or a request URL with secrets in it.

export const X_API = 'https://api.x.com';
export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type XApiErrorKind = 'http' | 'network' | 'timeout' | 'aborted' | 'invalid_response';

export class XApiError extends Error {
  constructor(
    readonly kind: XApiErrorKind,
    /** The HTTP status, when X answered. */
    readonly status: number | null,
    /** The problem `type` (e.g. https://api.x.com/2/problems/usage-capped) or the OAuth `error`. */
    readonly problem: string | null,
    /** X's own explanation, if it sent one. */
    readonly detail: string,
    /** Epoch ms when the rate limit that caused a 429 resets. */
    readonly resetAt: number | null = null,
  ) {
    super(`X API ${kind}${status ? ` ${status}` : ''}${problem ? ` ${problem}` : ''}: ${detail}`);
    this.name = 'XApiError';
  }

  /** No answer arrived, so the request may or may not have taken effect. */
  get uncertain(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || (this.kind === 'http' && (this.status ?? 0) >= 500);
  }
}

export interface TokenSet {
  access: string;
  refresh: string | null;
  /** ISO time the access token expires. */
  expiresAt: string;
  scope: string;
}

export interface ProcessingInfo {
  state: 'pending' | 'in_progress' | 'succeeded' | 'failed';
  checkAfterSecs: number | null;
  percent: number | null;
  error: string | null;
}

export interface TimelinePost {
  id: string;
  text: string;
  createdAt: string | null;
  mediaKeys: string[];
}

export interface ApiOptions {
  fetch: FetchLike;
  now?: () => number;
  /** Per-request timeout for everything but the create call. */
  timeoutMs?: number;
  /** Timeout for POST /2/tweets: past it the outcome is uncertain. */
  createTimeoutMs?: number;
  /** Delay between bounded retries of idempotent calls. */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

const problemSchema = z.looseObject({
  title: z.string().optional(),
  detail: z.string().optional(),
  type: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
  errors: z.array(z.looseObject({ message: z.string().optional(), detail: z.string().optional(), title: z.string().optional() })).optional(),
});

const tokenSchema = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().default(''),
});

const idSchema = z.string().regex(/^\d{1,19}$/);

const meSchema = z.looseObject({
  data: z.looseObject({ id: idSchema, name: z.string(), username: z.string().min(1).max(50) }),
});

const processingSchema = z
  .looseObject({
    state: z.enum(['pending', 'in_progress', 'succeeded', 'failed']),
    check_after_secs: z.number().nonnegative().optional(),
    progress_percent: z.number().optional(),
    error: z.looseObject({ message: z.string().optional(), name: z.string().optional() }).optional(),
  })
  .optional();

const initSchema = z.looseObject({
  data: z.looseObject({ id: idSchema, media_key: z.string().optional(), expires_after_secs: z.number().optional() }),
});

const mediaStatusSchema = z.looseObject({
  data: z.looseObject({ id: idSchema.optional(), expires_after_secs: z.number().optional(), processing_info: processingSchema }),
});

const createSchema = z.looseObject({ data: z.looseObject({ id: idSchema }) });

const timelineSchema = z.looseObject({
  data: z
    .array(
      z.looseObject({
        id: idSchema,
        text: z.string(),
        created_at: z.string().optional(),
        attachments: z.looseObject({ media_keys: z.array(z.string()).optional() }).optional(),
      }),
    )
    .optional(),
  meta: z.looseObject({ next_token: z.string().optional() }).optional(),
});

function header(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** When a 429 lifts: the daily user cap's reset if that cap is the one exhausted, else the window's. */
function rateLimitReset(headers: Headers): number | null {
  const daily = header(headers, 'x-user-limit-24hour-remaining') === 0 ? header(headers, 'x-user-limit-24hour-reset') : null;
  const reset = daily ?? header(headers, 'x-rate-limit-reset');
  return reset === null ? null : reset * 1000;
}

function problemOf(status: number, body: unknown): { problem: string | null; detail: string } {
  const parsed = problemSchema.safeParse(body);
  if (!parsed.success) return { problem: null, detail: `HTTP ${status}` };
  const p = parsed.data;
  const first = p.errors?.[0];
  const detail = p.detail ?? p.error_description ?? first?.detail ?? first?.message ?? p.title ?? first?.title ?? `HTTP ${status}`;
  return { problem: p.type && p.type !== 'about:blank' ? p.type : (p.error ?? null), detail: detail.slice(0, 500) };
}

/** A multipart/form-data body built as bytes, so it works with any fetch. */
function multipart(fields: Record<string, string>, file: { name: string; data: Uint8Array }): { body: Buffer; contentType: string } {
  const boundary = `----xbot${randomBytes(12).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="blob"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(file.data),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export type XApi = ReturnType<typeof createXApi>;

export function createXApi({
  fetch,
  now = Date.now,
  timeoutMs = 60_000,
  createTimeoutMs = 30_000,
  retryDelayMs = 1000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: ApiOptions) {
  interface Call {
    method: 'GET' | 'POST';
    path: string;
    token?: string;
    query?: Record<string, string>;
    json?: unknown;
    form?: Record<string, string>;
    body?: { body: Buffer; contentType: string };
    timeout?: number;
    signal?: AbortSignal;
  }

  async function call(c: Call): Promise<{ status: number; body: unknown }> {
    const url = new URL(c.path, X_API);
    for (const [k, v] of Object.entries(c.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (c.token) headers.Authorization = `Bearer ${c.token}`;
    let body: RequestInit['body'];
    if (c.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(c.json);
    } else if (c.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(c.form).toString();
    } else if (c.body) {
      headers['Content-Type'] = c.body.contentType;
      body = new Uint8Array(c.body.body);
    }

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), c.timeout ?? timeoutMs);
    const signal = c.signal ? AbortSignal.any([timeout.signal, c.signal]) : timeout.signal;
    let response: Response;
    try {
      response = await fetch(url.toString(), { method: c.method, headers, body, signal, credentials: 'omit', redirect: 'error' });
    } catch {
      clearTimeout(timer);
      if (c.signal?.aborted) throw new XApiError('aborted', null, null, 'The request was stopped.');
      if (timeout.signal.aborted) throw new XApiError('timeout', null, null, 'X didn’t answer in time.');
      throw new XApiError('network', null, null, 'X couldn’t be reached.');
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      clearTimeout(timer);
      if (c.signal?.aborted) throw new XApiError('aborted', null, null, 'The request was stopped.');
      throw new XApiError(timeout.signal.aborted ? 'timeout' : 'network', response.status, null, 'X’s answer was cut off.');
    }
    clearTimeout(timer);
    let parsed: unknown = null;
    if (text.trim() !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (response.status >= 400) {
      const { problem, detail } = problemOf(response.status, parsed);
      throw new XApiError('http', response.status, problem, detail, response.status === 429 ? rateLimitReset(response.headers) : null);
    }
    return { status: response.status, body: parsed };
  }

  function parse<T>(schema: z.ZodType<T>, result: { status: number; body: unknown }, what: string): T {
    const parsed = schema.safeParse(result.body);
    if (!parsed.success) throw new XApiError('invalid_response', result.status, null, `X sent an unexpected answer to ${what}.`);
    return parsed.data;
  }

  /** Bounded retries for idempotent calls: network errors, timeouts, 5xx, and a 429 that lifts within a minute. */
  async function retrying<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof XApiError) || attempt >= tries) throw err;
        const waitForReset = err.status === 429 && err.resetAt !== null ? err.resetAt - now() : null;
        if (err.status === 429 && (waitForReset === null || waitForReset > 60_000)) throw err;
        if (err.status !== 429 && !err.uncertain) throw err;
        await sleep(Math.max(waitForReset ?? 0, retryDelayMs * attempt));
      }
    }
  }

  function tokenSet(t: z.infer<typeof tokenSchema>, previousRefresh: string | null = null): TokenSet {
    return {
      access: t.access_token,
      refresh: t.refresh_token ?? previousRefresh,
      expiresAt: new Date(now() + t.expires_in * 1000).toISOString(),
      scope: t.scope,
    };
  }

  function processing(info: z.infer<typeof processingSchema>): ProcessingInfo | null {
    if (!info) return null;
    return {
      state: info.state,
      checkAfterSecs: info.check_after_secs ?? null,
      percent: info.progress_percent ?? null,
      error: info.error?.message ?? info.error?.name ?? null,
    };
  }

  return {
    async exchangeCode(p: { clientId: string; code: string; redirectUri: string; verifier: string }): Promise<TokenSet> {
      const result = await call({
        method: 'POST',
        path: '/2/oauth2/token',
        form: { grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier, client_id: p.clientId },
      });
      return tokenSet(parse(tokenSchema, result, 'the sign-in'));
    },

    async refresh(p: { clientId: string; refreshToken: string }): Promise<TokenSet> {
      const result = await call({
        method: 'POST',
        path: '/2/oauth2/token',
        form: { grant_type: 'refresh_token', refresh_token: p.refreshToken, client_id: p.clientId },
      });
      return tokenSet(parse(tokenSchema, result, 'the token refresh'), p.refreshToken);
    },

    async revoke(p: { clientId: string; token: string }): Promise<void> {
      await call({ method: 'POST', path: '/2/oauth2/revoke', form: { token: p.token, client_id: p.clientId } });
    },

    async me(token: string): Promise<{ id: string; name: string; username: string }> {
      const result = await retrying(() => call({ method: 'GET', path: '/2/users/me', token }));
      return parse(meSchema, result, 'the account lookup').data;
    },

    async initUpload(
      token: string,
      p: { mediaType: string; totalBytes: number; category: string },
      opts: RequestOptions = {},
    ): Promise<{ id: string; mediaKey: string | null; expiresAfterSecs: number | null }> {
      const result = await retrying(() =>
        call({
          method: 'POST',
          path: '/2/media/upload/initialize',
          token,
          json: { media_type: p.mediaType, total_bytes: p.totalBytes, media_category: p.category },
          signal: opts.signal,
        }),
      );
      const { data } = parse(initSchema, result, 'the upload');
      return { id: data.id, mediaKey: data.media_key ?? null, expiresAfterSecs: data.expires_after_secs ?? null };
    },

    async appendUpload(token: string, id: string, segmentIndex: number, chunk: Uint8Array, opts: RequestOptions = {}): Promise<void> {
      const body = multipart({ segment_index: String(segmentIndex) }, { name: 'media', data: chunk });
      await retrying(() => call({ method: 'POST', path: `/2/media/upload/${id}/append`, token, body, signal: opts.signal }));
    },

    async finalizeUpload(token: string, id: string, opts: RequestOptions = {}): Promise<{ processing: ProcessingInfo | null; expiresAfterSecs: number | null }> {
      const result = await retrying(() => call({ method: 'POST', path: `/2/media/upload/${id}/finalize`, token, signal: opts.signal }));
      const { data } = parse(mediaStatusSchema, result, 'the upload');
      return { processing: processing(data.processing_info), expiresAfterSecs: data.expires_after_secs ?? null };
    },

    async uploadStatus(token: string, id: string, opts: RequestOptions = {}): Promise<{ processing: ProcessingInfo | null; expiresAfterSecs: number | null }> {
      const result = await retrying(() =>
        call({ method: 'GET', path: '/2/media/upload', token, query: { command: 'STATUS', media_id: id }, signal: opts.signal }),
      );
      const { data } = parse(mediaStatusSchema, result, 'the processing check');
      return { processing: processing(data.processing_info), expiresAfterSecs: data.expires_after_secs ?? null };
    },

    /** POST /2/tweets, sent exactly once: never retried here, whatever happens. */
    async createPost(token: string, p: { text: string; mediaIds: readonly string[] }, opts: RequestOptions = {}): Promise<{ id: string }> {
      const json = p.mediaIds.length > 0 ? { text: p.text, media: { media_ids: [...p.mediaIds] } } : { text: p.text };
      const result = await call({ method: 'POST', path: '/2/tweets', token, json, timeout: createTimeoutMs, signal: opts.signal });
      return parse(createSchema, result, 'the post').data;
    },

    async userPosts(
      token: string,
      userId: string,
      p: { startTime: string; paginationToken?: string },
      opts: RequestOptions = {},
    ): Promise<{ posts: TimelinePost[]; nextToken: string | null }> {
      const query: Record<string, string> = {
        start_time: p.startTime,
        max_results: '10',
        exclude: 'replies,retweets',
        // docs.x.com names it post.fields (formerly tweet.fields).
        'post.fields': 'created_at,attachments',
        expansions: 'attachments.media_keys',
      };
      if (p.paginationToken) query.pagination_token = p.paginationToken;
      const result = await retrying(() => call({ method: 'GET', path: `/2/users/${userId}/tweets`, token, query, signal: opts.signal }));
      const parsed = parse(timelineSchema, result, 'the timeline');
      return {
        posts: (parsed.data ?? []).map((d) => ({ id: d.id, text: d.text, createdAt: d.created_at ?? null, mediaKeys: d.attachments?.media_keys ?? [] })),
        nextToken: parsed.meta?.next_token ?? null,
      };
    },
  };
}
