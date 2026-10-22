import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { log } from '../log';

// `xbot-media://media/<path relative to userData/media>` — the only way a page
// loads user media — `xbot-media://wallpapers/<file>` for the Studio's
// bundled wallpapers and `xbot-media://recordings/<id>/<file>` for a
// recording's camera and cursor data. Serves real files whose realpath stays inside that
// host's folder (no traversal, no symlink escapes); everything else is a 404.
// Single byte ranges get a proper 206, so <video> can seek.

export const MEDIA_SCHEME = 'xbot-media';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.json': 'application/json',
};

/** Must run before `app.whenReady()`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ]);
}

export interface MediaRoots {
  /** userData/media. */
  media: string;
  /** The bundled wallpapers (resources/wallpapers). */
  wallpapers: string;
  /** userData/recordings: a recording's camera video, cursor data and cursor images. */
  recordings?: string;
}

export async function resolveMediaPath(roots: MediaRoots | string, rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${MEDIA_SCHEME}:`) return null;
  const { media, wallpapers, recordings } = typeof roots === 'string' ? { media: roots, wallpapers: null, recordings: null } : roots;
  const mediaRoot = url.hostname === 'media' ? media : url.hostname === 'wallpapers' ? wallpapers : url.hostname === 'recordings' ? (recordings ?? null) : null;
  if (!mediaRoot) return null;

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

/** Parses a single `bytes=` range; null means "serve the whole file", 'invalid' means 416. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // multi-range or malformed: a full 200 is allowed
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return 'invalid';
  let start: number;
  let end: number;
  if (from === '') {
    start = Math.max(size - Number(to), 0);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

export function handleMediaProtocol(roots: MediaRoots): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const file = await resolveMediaPath(roots, request.url);
    if (!file) {
      log.warn('media: 404', request.url);
      return new Response('Not found', { status: 404 });
    }
    const { size } = await stat(file);
    const headers = new Headers({
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      // Only xBot's own pages can reach this scheme; CORS keeps canvases untainted.
      'Access-Control-Allow-Origin': '*',
    });

    const range = parseRange(request.headers.get('Range'), size);
    if (range === 'invalid') {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    headers.set('Content-Length', String(size === 0 ? 0 : end - start + 1));
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    const body =
      size === 0 ? null : (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>);
    return new Response(body, { status: range ? 206 : 200, headers });
  });
}
