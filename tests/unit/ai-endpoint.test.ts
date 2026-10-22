import { describe, expect, it } from 'vitest';
import { isLoopbackEndpoint, isLoopbackRequestUrl, requestBase } from '../../src/shared/aiEndpoint';
import { aiSettings } from '../../src/shared/contracts/ai';
import { installLoopbackFetchSpy } from './helpers/loopbackFetch';

// SPEC §22 "Nonlocal endpoint rejection": only this Mac's Ollama is allowed.

installLoopbackFetchSpy({ expectRequests: false });

describe('the loopback endpoint rule', () => {
  it.each(['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434', 'http://127.0.0.1:11434/', 'HTTP://LOCALHOST:8080', 'http://127.0.0.1:80'])(
    'accepts %s',
    (endpoint) => {
      expect(isLoopbackEndpoint(endpoint)).toBe(true);
    },
  );

  it.each([
    'http://10.0.0.5:11434',
    'http://example.com:11434',
    'http://127.0.0.1.evil.com:11434',
    'http://127.0.0.1.evil.com',
    'https://127.0.0.1:11434',
    'http://127.0.0.1',
    'http://localhost',
    'http://127.1:11434',
    'http://0x7f.0.0.1:11434',
    'http://127.0.0.2:11434',
    'http://0.0.0.0:11434',
    'http://user:pass@127.0.0.1:11434',
    'http://127.0.0.1:11434/api',
    'http://127.0.0.1:11434?x=1',
    'http://127.0.0.1:11434#x',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://localhost.example.com:11434',
    '',
  ])('rejects %s', (endpoint) => {
    expect(isLoopbackEndpoint(endpoint)).toBe(false);
  });

  it('sends localhost requests to 127.0.0.1, so no DNS lookup decides where they go', () => {
    expect(requestBase('http://localhost:11434')).toBe('http://127.0.0.1:11434');
    expect(requestBase('http://[::1]:11434/')).toBe('http://[::1]:11434');
    expect(() => requestBase('http://example.com:11434')).toThrow();
  });

  it('checks every request URL: plain http to exactly 127.0.0.1 or [::1]', () => {
    expect(isLoopbackRequestUrl('http://127.0.0.1:11434/api/tags')).toBe(true);
    expect(isLoopbackRequestUrl('http://[::1]:11434/api/tags')).toBe(true);
    expect(isLoopbackRequestUrl('http://localhost:11434/api/tags')).toBe(false);
    expect(isLoopbackRequestUrl('http://127.0.0.1.evil.com/api/tags')).toBe(false);
    expect(isLoopbackRequestUrl('https://127.0.0.1:11434/api/tags')).toBe(false);
    expect(isLoopbackRequestUrl('not a url')).toBe(false);
  });

  it('is the ai.endpoint setting schema, so a non-local endpoint cannot be stored', () => {
    const schema = aiSettings['ai.endpoint'].schema;
    expect(schema.safeParse('http://127.0.0.1:11434').success).toBe(true);
    expect(schema.safeParse('http://10.0.0.5:11434').success).toBe(false);
    expect(schema.safeParse('http://example.com:11434').success).toBe(false);
  });
});
