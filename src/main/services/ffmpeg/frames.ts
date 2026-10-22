import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runTool, type Runner } from './run';

// The timeline's filmstrip: N frames evenly spaced over the clip, each from a
// fast input seek (never a decode of the whole file), small JPEGs cached by
// the source's hash for this run (tmp/ is emptied at every start). Each call
// writes its own `.partial` and renames it into place, so two requests for
// the same clip (a page reloaded mid-strip, T10) never clobber each other.

export const FILMSTRIP_FRAMES = 8;
/** Twice the strip's 37 CSS px, for Retina. */
export const FILMSTRIP_HEIGHT = 80;

export interface FilmstripOptions {
  ffmpeg: string;
  source: string;
  durationMs: number;
  /** A folder of its own, e.g. tmp/filmstrips/<sha256>. */
  dir: string;
  signal?: AbortSignal;
  run?: Runner;
  count?: number;
}

/** The JPEG bytes of each frame, left to right; generated once per folder. */
export async function filmstrip({ ffmpeg, source, durationMs, dir, signal, run = runTool, count = FILMSTRIP_FRAMES }: FilmstripOptions): Promise<Uint8Array[]> {
  mkdirSync(dir, { recursive: true });
  const frames: Uint8Array[] = [];
  // One at a time: a filmstrip must never compete with an export for the CPU.
  for (let i = 0; i < count; i++) {
    const file = join(dir, `${String(i).padStart(2, '0')}.jpg`);
    if (!existsSync(file)) {
      const at = ((i + 0.5) * durationMs) / count / 1000;
      const partial = `${file}.${randomUUID()}.partial`;
      await run(
        ffmpeg,
        ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-noaccurate_seek', '-ss', at.toFixed(3), '-i', source, '-frames:v', '1', '-vf', `scale=-2:${FILMSTRIP_HEIGHT}`, '-c:v', 'mjpeg', '-q:v', '5', '-update', '1', '-f', 'image2', partial],
        { timeoutMs: 15_000, signal },
      ).catch(async (err: unknown) => {
        await unlink(partial).catch(() => {});
        throw err;
      });
      await rename(partial, file);
    }
    frames.push(new Uint8Array(await readFile(file)));
  }
  return frames;
}
