import { describe, expect, it } from 'vitest';
import { defaultCursor } from '../../src/shared/composition/model';
import { segmentsOnTimeline } from '../../src/shared/composition/timeline';
import { AUTO_ZOOM, autoZooms } from '../../src/shared/recording/autoZoom';
import { createMotion, cursorFrame, focusAt, rawCursorAt } from '../../src/shared/recording/motion';
import type { CursorSample, CursorTrack } from '../../src/shared/recording/track';

// The cursor the editor draws (smoothed, fading when idle, rippling on
// clicks) and Cap-style automatic zooms built from the clicks.

function track(samples: CursorSample[]): CursorTrack {
  return { version: 1, samples, cursors: [] };
}

const move = (t: number, x: number, y: number): CursorSample => ({ t, x, y, type: 0, cursor: 0 });
const click = (t: number, x: number, y: number): CursorSample => ({ t, x, y, type: 1, cursor: 0 });

describe('cursor motion', () => {
  const jump = track([move(0, 0.1, 0.1), move(1000, 0.1, 0.1), move(1001, 0.9, 0.9), move(3000, 0.9, 0.9)]);
  const motion = createMotion(jump);

  it('the raw cursor jumps; the smoothed one glides there without overshooting', () => {
    expect(rawCursorAt(jump, 1100)!.x).toBeCloseTo(0.9, 5);
    const frame = (ms: number) => cursorFrame(motion, ms, defaultCursor())!;
    expect(frame(1050).x).toBeGreaterThan(0.1);
    expect(frame(1050).x).toBeLessThan(0.9);
    let previous = 0;
    for (let ms = 1000; ms < 2500; ms += 25) {
      const { x } = frame(ms);
      expect(x).toBeGreaterThanOrEqual(previous - 1e-6);
      expect(x).toBeLessThanOrEqual(0.9 + 1e-3);
      previous = x;
    }
    expect(frame(2500).x).toBeCloseTo(0.9, 2);
  });

  it('the zoom focus follows more slowly than the cursor', () => {
    const cursor = cursorFrame(motion, 1150, defaultCursor())!;
    expect(focusAt(motion, 1150).x).toBeLessThan(cursor.x);
  });

  it('fades out when idle, only with Hide when idle on', () => {
    expect(cursorFrame(motion, 1500, { ...defaultCursor(), hideWhenIdle: true })!.opacity).toBe(1);
    expect(cursorFrame(createMotion(track([move(0, 0.5, 0.5), move(5000, 0.5, 0.5)])), 4000, { ...defaultCursor(), hideWhenIdle: true })!.opacity).toBe(0);
    expect(cursorFrame(motion, 2900, defaultCursor())!.opacity).toBe(1);
  });

  it('ripples and presses on a click, then settles', () => {
    const clicked = createMotion(track([move(0, 0.5, 0.5), click(500, 0.5, 0.5), move(2000, 0.5, 0.5)]));
    const during = cursorFrame(clicked, 600, defaultCursor())!;
    expect(during.ripples).toHaveLength(1);
    expect(during.scale).toBeLessThan(1);
    expect(cursorFrame(clicked, 1500, defaultCursor())!.ripples).toHaveLength(0);
    expect(cursorFrame(clicked, 600, { ...defaultCursor(), clickEffect: false })!.ripples).toHaveLength(0);
  });
});

describe('automatic zoom', () => {
  let n = 0;
  const id = () => `z${n++}`;

  it('turns each cluster of clicks into one 2× auto zoom, with lead and hold', () => {
    const zooms = autoZooms(track([move(0, 0.2, 0.2), click(2000, 0.3, 0.4), click(3000, 0.3, 0.4), click(12_000, 0.8, 0.8)]), 20_000, id);
    expect(zooms).toHaveLength(2);
    expect(zooms[0]).toMatchObject({ startMs: 2000 - AUTO_ZOOM.leadMs, endMs: 3000 + AUTO_ZOOM.holdMs, scale: 2, mode: 'auto', x: 0.3, y: 0.4 });
    expect(zooms[1]).toMatchObject({ startMs: 12_000 - AUTO_ZOOM.leadMs, endMs: 12_000 + AUTO_ZOOM.holdMs });
  });

  it('keeps zooms inside the recording and makes none without clicks', () => {
    expect(autoZooms(track([click(100, 0.5, 0.5)]), 1500, id)[0]).toMatchObject({ startMs: 0, endMs: 1500 });
    expect(autoZooms(track([click(100, 0.5, 0.5)]), 1200, id)).toEqual([]);
    expect(autoZooms(track([move(0, 0.5, 0.5)]), 5000, id)).toEqual([]);
  });

  it('places recording-time zooms on an edited timeline, dropping ones a cut removes', () => {
    const video = { clips: [{ startMs: 5000, endMs: 10_000 }], zooms: [], scenes: [], muted: false };
    const placed = segmentsOnTimeline(video, [
      { startMs: 1000, endMs: 3000 },
      { startMs: 6000, endMs: 8000 },
    ]);
    expect(placed).toEqual([{ startMs: 1000, endMs: 3000 }]);
  });
});
