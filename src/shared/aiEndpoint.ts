// The local-only endpoint rule (docs/OLLAMA.md → "How xBot enforces
// local-only"). Zod-free and Node-free: the `ai.endpoint` setting's schema,
// the main-process Ollama client and the settings UI all use it.

export const DEFAULT_AI_ENDPOINT = 'http://127.0.0.1:11434';

// The raw string is matched, not WHATWG's parsed URL: `new URL()` would
// normalise `127.1` or `0x7f.0.0.1` to 127.0.0.1 and drop an explicit `:80`.
const ENDPOINT = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})\/?$/;

function parse(raw: string): { host: string; port: number } | null {
  const match = ENDPOINT.exec(raw.trim().toLowerCase());
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { host: match[1]!, port };
}

/**
 * True only for `http://127.0.0.1:<port>`, `http://localhost:<port>` or
 * `http://[::1]:<port>` (an optional trailing `/`), with no credentials,
 * path, query or hash.
 */
export function isLoopbackEndpoint(raw: string): boolean {
  return parse(raw) !== null;
}

/**
 * The base URL requests are sent to. `localhost` becomes `127.0.0.1`, so no
 * DNS lookup or hosts-file entry decides where a request goes. Throws for an
 * endpoint that is not loopback.
 */
export function requestBase(raw: string): string {
  const parsed = parse(raw);
  if (!parsed) throw new Error('not a loopback endpoint');
  const host = parsed.host === 'localhost' ? '127.0.0.1' : parsed.host;
  return `http://${host}:${parsed.port}`;
}

/** The per-request check: plain http to exactly 127.0.0.1 or [::1]. */
export function isLoopbackRequestUrl(url: string | URL): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') &&
    parsed.username === '' &&
    parsed.password === ''
  );
}
