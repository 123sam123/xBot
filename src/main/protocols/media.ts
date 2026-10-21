import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { log } from '../log';

// `xbot-media://media/<path relative to userData/media>` — the only way a page
// loads user media. Serves real files whose realpath stays inside the media
// folder (no traversal, no symlink escapes); everything else is a 404.

export const MEDIA_SCHEME = 'xbot-media';

/** Must run before `app.whenReady()`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

export async function resolveMediaPath(mediaRoot: string, rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== 'media') return null;

  let candidate: string;
  try {
    candidate = join(mediaRoot, decodeURIComponent(url.pathname));
  } catch {
    return null;
  }
  try {
    const [root, real] = await Promise.all([realpath(mediaRoot), realpath(candidate)]);
    const rel = relative(root, real);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
    return (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

export function handleMediaProtocol(mediaRoot: string): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const file = await resolveMediaPath(mediaRoot, request.url);
    if (!file) {
      log.warn('media: 404', request.url);
      return new Response('Not found', { status: 404 });
    }
    // Forward the request headers so Range requests (video seeking) work.
    const response = await net.fetch(pathToFileURL(file).toString(), { headers: request.headers });
    const headers = new Headers(response.headers);
    // Only xBot's own pages can reach this scheme; CORS keeps canvases untainted.
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
}
