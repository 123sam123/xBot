import { afterAll, expect, vi } from 'vitest';

// The guard every ai-*.test.ts installs: a spy on the global fetch that the
// Ollama client uses (it looks fetch up at call time, and tests never pass
// their own). Any request to a host other than exactly 127.0.0.1 or [::1]
// fails at once, before it reaches the network, and is still recorded, so
// afterAll fails the file even if the code under test swallowed the error.

const LOOPBACK = new Set(['127.0.0.1', '[::1]']);

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function installLoopbackFetchSpy({ expectRequests }: { expectRequests: boolean }): { urls: string[] } {
  const original = globalThis.fetch;
  const urls: string[] = [];
  const spy = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);
    urls.push(url);
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // recorded; fails below
    }
    if (!LOOPBACK.has(host)) return Promise.reject(new Error(`loopback guard: refused a request to ${url}`));
    return original(input, init);
  });
  globalThis.fetch = spy as typeof fetch;

  afterAll(() => {
    globalThis.fetch = original;
    for (const url of urls) expect(LOOPBACK.has(new URL(url).hostname), `request to ${url}`).toBe(true);
    if (expectRequests) expect(urls.length, 'this suite should have talked to the mock Ollama').toBeGreaterThan(0);
  });
  return { urls };
}
