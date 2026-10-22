import { afterEach, describe, expect, it } from 'vitest';
import { createOllamaClient, OllamaError, proxyBlocks } from '../../src/main/services/ai/ollamaClient';
import { installLoopbackFetchSpy } from './helpers/loopbackFetch';
import { chatLines, json, ndjson, startMockOllama, type MockOllama } from './helpers/mockOllama';

// The Ollama client against a real HTTP server on 127.0.0.1: redirects are
// refused (never followed), every request stays on loopback, and responses
// are validated.

const guard = installLoopbackFetchSpy({ expectRequests: true });

let mock: MockOllama;
let other: MockOllama | null = null;
afterEach(async () => {
  await mock?.close();
  await other?.close();
  other = null;
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return err instanceof OllamaError ? err.code : `not an OllamaError: ${String(err)}`;
  }
  return 'resolved';
}

describe('redirects', () => {
  it('refuses a 302 to a remote host instead of following it', async () => {
    mock = await startMockOllama({
      'GET /api/tags': (_req, res) => {
        res.writeHead(302, { location: 'http://example.invalid/api/tags' });
        res.end();
      },
    });
    const client = createOllamaClient({ endpoint: mock.endpoint });
    // A followed redirect would fail DNS for .invalid and surface as `unreachable`.
    expect(await codeOf(client.tags())).toBe('redirect_refused');
    expect(guard.urls.some((u) => u.includes('example.invalid'))).toBe(false);
  });

  it('never reaches the host a redirect points to, even a loopback one', async () => {
    other = await startMockOllama();
    mock = await startMockOllama({
      'POST /api/chat': (_req, res) => {
        res.writeHead(307, { location: `${other!.endpoint}/api/chat` });
        res.end();
      },
      'GET /api/version': (_req, res) => {
        res.writeHead(301, { location: `${other!.endpoint}/api/version` });
        res.end();
      },
    });
    const client = createOllamaClient({ endpoint: mock.endpoint });
    expect(await codeOf(client.version())).toBe('redirect_refused');
    expect(
      await codeOf(
        client.chat(
          { model: 'gemma3:4b', messages: [{ role: 'user', content: 'hi' }], format: {}, keep_alive: '5m', options: { num_ctx: 4096, num_predict: 64, temperature: 0.6 } },
          { attemptTimeoutMs: 5000, onChunk: () => {} },
        ),
      ),
    ).toBe('redirect_refused');
    expect(other.requests).toHaveLength(0);
  });
});

describe('endpoint and transport', () => {
  it('refuses to be created for a non-loopback endpoint, so nothing is sent', async () => {
    mock = await startMockOllama();
    const before = guard.urls.length;
    for (const endpoint of ['http://10.0.0.5:11434', 'http://example.com:11434', 'http://127.0.0.1.evil.com']) {
      expect(() => createOllamaClient({ endpoint })).toThrow(OllamaError);
    }
    expect(guard.urls.length).toBe(before);
  });

  it('sends localhost requests to 127.0.0.1', async () => {
    mock = await startMockOllama();
    const client = createOllamaClient({ endpoint: `http://localhost:${mock.port}` });
    await expect(client.version()).resolves.toMatchObject({ version: '0.31.1' });
    expect(guard.urls.at(-1)).toBe(`http://127.0.0.1:${mock.port}/api/version`);
  });

  it('refuses every request when a proxy would carry it, before calling fetch', async () => {
    mock = await startMockOllama();
    const env = { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://proxy.example:3128' };
    expect(proxyBlocks(env, [], '127.0.0.1')).toBe(true);
    expect(proxyBlocks({ ...env, NO_PROXY: 'localhost,127.0.0.1' }, [], '127.0.0.1')).toBe(false);
    expect(proxyBlocks({ HTTP_PROXY: 'http://proxy.example:3128' }, [], '127.0.0.1')).toBe(false); // Node ignores it without the opt-in
    expect(proxyBlocks({ HTTP_PROXY: 'http://proxy.example:3128' }, ['--use-env-proxy'], '127.0.0.1')).toBe(true);
    const before = guard.urls.length;
    const client = createOllamaClient({ endpoint: mock.endpoint, env });
    expect(await codeOf(client.version())).toBe('endpoint_proxied');
    expect(guard.urls.length).toBe(before);
  });

  it('times a probe out with `timeout`, not as a cancel', async () => {
    mock = await startMockOllama({ 'GET /api/tags': () => {} }); // never answers
    const client = createOllamaClient({ endpoint: mock.endpoint, probeTimeoutMs: 150 });
    expect(await codeOf(client.tags())).toBe('timeout');
  });

  it('rejects a response that is not Ollama’s shape', async () => {
    mock = await startMockOllama({ 'GET /api/tags': (_req, res) => json(res, { hello: 'world' }) });
    const client = createOllamaClient({ endpoint: mock.endpoint });
    expect(await codeOf(client.tags())).toBe('bad_response');
  });

  it('keeps fields a newer Ollama adds, and reads remote metadata', async () => {
    mock = await startMockOllama({
      'GET /api/tags': (_req, res) => json(res, { models: [{ name: 'x:cloud', size: 384, digest: 'd', remote_host: 'https://ollama.com:443', future: 1 }] }),
    });
    const client = createOllamaClient({ endpoint: mock.endpoint });
    const tags = await client.tags();
    expect(tags.models[0]?.remote_host).toBe('https://ollama.com:443');
  });
});

describe('chat stream', () => {
  const body = { model: 'gemma3:4b', messages: [{ role: 'user' as const, content: 'hi' }], format: {}, keep_alive: '5m', options: { num_ctx: 4096, num_predict: 64, temperature: 0.6 } };

  it('refuses a stream whose chunks say they came from a remote host', async () => {
    mock = await startMockOllama({
      'POST /api/chat': (_req, res) => ndjson(res, chatLines('{"text":"ok"}', { extra: { remote_host: 'https://ollama.com:443' } })),
    });
    const client = createOllamaClient({ endpoint: mock.endpoint });
    expect(await codeOf(client.chat(body, { attemptTimeoutMs: 5000, onChunk: () => {} }))).toBe('remote_refused');
  });

  it('reports an error line mid-stream with Ollama’s text', async () => {
    mock = await startMockOllama({ 'POST /api/chat': (_req, res) => ndjson(res, [{ message: { content: '{' }, done: false }, { error: 'model runner crashed' }]) });
    const client = createOllamaClient({ endpoint: mock.endpoint });
    const err = await client.chat(body, { attemptTimeoutMs: 5000, onChunk: () => {} }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'http_error', detail: 'model runner crashed' });
  });

  it('treats a stream that ends without done as stopped', async () => {
    mock = await startMockOllama({ 'POST /api/chat': (_req, res) => ndjson(res, [{ message: { content: '{"te' }, done: false }]) });
    const client = createOllamaClient({ endpoint: mock.endpoint });
    expect(await codeOf(client.chat(body, { attemptTimeoutMs: 5000, onChunk: () => {} }))).toBe('stream_error');
  });
});
