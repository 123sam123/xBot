import type { ZoomSegment } from '../composition/model';
import type { CursorTrack } from './track';

// Cap's "Automatic Zoom": the recording zooms in where the work happens.
// Clicks close together in time form one cluster; each cluster becomes a 2×
// segment that starts a little before its first click and holds a little
// after its last, and while it lasts the focus follows the cursor (mode
// 'auto'). Segments that would touch are merged. Pure and zod-free.

export const AUTO_ZOOM = {
  scale: 2,
  /** Clicks further apart than this start a new cluster. */
  gapMs: 2600,
  leadMs: 700,
  holdMs: 1600,
  /** Shorter segments are dropped (a zoom needs time to ease in and out). */
  minMs: 1400,
} as const;

export function autoZooms(track: CursorTrack, durationMs: number, makeId: () => string): ZoomSegment[] {
  const clicks = track.samples.filter((s) => s.type === 1).map((s) => s.t);
  const ranges: { startMs: number; endMs: number; x: number; y: number }[] = [];
  let cluster: number[] = [];
  const close = () => {
    if (cluster.length === 0) return;
    const startMs = Math.max(0, cluster[0]! - AUTO_ZOOM.leadMs);
    const endMs = Math.min(durationMs, cluster.at(-1)! + AUTO_ZOOM.holdMs);
    const first = track.samples.find((s) => s.t >= cluster[0]!);
    const previous = ranges.at(-1);
    if (previous && startMs <= previous.endMs + 300) previous.endMs = Math.max(previous.endMs, endMs);
    else ranges.push({ startMs, endMs, x: first?.x ?? 0.5, y: first?.y ?? 0.5 });
    cluster = [];
  };
  for (const t of clicks) {
    if (cluster.length > 0 && t - cluster.at(-1)! > AUTO_ZOOM.gapMs) close();
    cluster.push(t);
  }
  close();
  return ranges
    .filter((range) => range.endMs - range.startMs >= AUTO_ZOOM.minMs)
    .map((range) => ({
      id: makeId(),
      startMs: Math.round(range.startMs),
      endMs: Math.round(range.endMs),
      scale: AUTO_ZOOM.scale,
      mode: 'auto' as const,
      x: Math.min(1, Math.max(0, range.x)),
      y: Math.min(1, Math.max(0, range.y)),
    }));
}
