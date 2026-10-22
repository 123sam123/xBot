import type { CursorImageInfo, CursorSample, CursorTrack } from '../../../shared/recording/track';

// A recording's cursor, loaded for drawing: the track (cursor.json) and its
// decoded cursor images.

export interface LoadedCursor {
  track: CursorTrack;
  images: ReadonlyMap<number, { bitmap: ImageBitmap; info: CursorImageInfo }>;
}

export async function loadCursor(url: string, base: string): Promise<LoadedCursor> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cursor track ${response.status}`);
  const track = (await response.json()) as CursorTrack;
  const images = new Map<number, { bitmap: ImageBitmap; info: CursorImageInfo }>();
  await Promise.all(
    track.cursors.map(async (info) => {
      const image = await fetch(base + info.file);
      if (image.ok) images.set(info.id, { bitmap: await createImageBitmap(await image.blob()), info });
    }),
  );
  return { track, images };
}

/** The last sample at or before `ms`, by binary search; -1 before the first. */
function indexAt(samples: readonly CursorSample[], ms: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export interface CursorPoint {
  /** Fractions of the captured frame. */
  x: number;
  y: number;
  cursor: number;
}

/** Where the cursor is at recording time `ms`: between two samples it moves in a straight line. */
export function cursorAt(track: CursorTrack, ms: number): CursorPoint | null {
  const { samples } = track;
  if (samples.length === 0) return null;
  const index = indexAt(samples, ms);
  if (index < 0) return { x: samples[0]!.x, y: samples[0]!.y, cursor: samples[0]!.cursor };
  const a = samples[index]!;
  const b = samples[index + 1];
  if (!b || b.t <= a.t) return { x: a.x, y: a.y, cursor: a.cursor };
  const k = Math.min(1, (ms - a.t) / (b.t - a.t));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, cursor: a.cursor };
}
