// A recording's cursor track: what the editor draws in place of the cursor
// the capture left out. Pure and zod-free; main writes it as cursor.json and
// the renderer reads it.

export interface CursorSample {
  /** Recording ms (pauses removed). */
  t: number;
  /** Fractions of the captured frame. */
  x: number;
  y: number;
  /** 0 move, 1 down, 2 up. */
  type: 0 | 1 | 2;
  /** The cursor image, an index into `cursors`. */
  cursor: number;
}

export interface CursorImageInfo {
  id: number;
  /** Relative to the recording's folder. */
  file: string;
  /** Hotspot and size as fractions of the captured frame's width. */
  hotX: number;
  hotY: number;
  width: number;
  height: number;
}

export interface CursorTrack {
  version: 1;
  samples: CursorSample[];
  cursors: CursorImageInfo[];
}

export interface RawEvent {
  t: number;
  x: number;
  y: number;
  type: number;
  cursor: number;
}

/** Host seconds → recording ms: time since the first frame, less any pause before it. Null inside a pause. */
export function recordingTime(host: number, firstHost: number, pauses: readonly (readonly [number, number])[]): number | null {
  let paused = 0;
  for (const [start, end] of pauses) {
    if (host >= start && host < end) return null;
    if (host >= end) paused += end - start;
  }
  return Math.max(0, (host - firstHost - paused) * 1000);
}

/**
 * The cursor track of a capture: events become recording time and fractions of
 * the captured area; the last position before the first frame starts the track.
 * Events after `endHost` (the click on Stop) are dropped.
 */
export function cursorTrack(
  events: readonly RawEvent[],
  images: readonly { id: number; hotX: number; hotY: number; width: number; height: number }[],
  capture: { firstHost: number; endHost: number; pauses: readonly (readonly [number, number])[]; bounds: { x: number; y: number; width: number; height: number } },
): CursorTrack {
  const { bounds } = capture;
  const samples: CursorSample[] = [];
  let before: RawEvent | null = null;
  for (const event of events) {
    if (event.t < capture.firstHost) {
      before = event;
      continue;
    }
    if (event.t > capture.endHost) break;
    const t = recordingTime(event.t, capture.firstHost, capture.pauses);
    if (t === null) continue;
    samples.push(sample(event, t, bounds));
  }
  if (before) samples.unshift(sample({ ...before, type: 0 }, 0, bounds));
  return {
    version: 1,
    samples,
    cursors: images.map((image) => ({
      id: image.id,
      file: `cursors/${image.id}.png`,
      hotX: image.hotX / bounds.width,
      hotY: image.hotY / bounds.width,
      width: image.width / bounds.width,
      height: image.height / bounds.width,
    })),
  };
}

function sample(event: RawEvent, t: number, bounds: { x: number; y: number; width: number; height: number }): CursorSample {
  return {
    t: Math.round(t * 10) / 10,
    x: (event.x - bounds.x) / bounds.width,
    y: (event.y - bounds.y) / bounds.height,
    type: (event.type === 1 || event.type === 2 ? event.type : 0) as 0 | 1 | 2,
    cursor: event.cursor,
  };
}

/** Where the camera's time 0 falls in the recording, ms (its start, in host time, as recording time). */
export function cameraOffsetMs(cameraStartHost: number, firstHost: number, pauses: readonly (readonly [number, number])[]): number {
  if (cameraStartHost < firstHost) return (cameraStartHost - firstHost) * 1000;
  return recordingTime(cameraStartHost, firstHost, pauses) ?? (cameraStartHost - firstHost) * 1000;
}
