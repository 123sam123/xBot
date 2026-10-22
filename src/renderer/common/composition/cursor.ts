import { createMotion, type CursorMotion } from '../../../shared/recording/motion';
import type { CursorImageInfo, CursorTrack } from '../../../shared/recording/track';

// A recording's cursor, loaded for drawing: the track (cursor.json), how it
// moves (shared/recording/motion) and its decoded cursor images.

export interface LoadedCursor {
  track: CursorTrack;
  motion: CursorMotion;
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
  return { track, motion: createMotion(track), images };
}
