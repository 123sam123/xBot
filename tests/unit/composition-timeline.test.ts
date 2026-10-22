import { describe, expect, it } from 'vitest';
import { videoExportLayout, zoomedSourceCrop } from '../../src/shared/composition/layout';
import { defaultComposition, upgradeComposition, type VideoSettings, type ZoomSegment } from '../../src/shared/composition/model';
import { compositionSchema } from '../../src/shared/composition/schema';
import {
  newSegmentRange,
  placeSegment,
  removeClip,
  sourceTimeAt,
  splitAt,
  timelineDuration,
  trimClip,
  ZOOM_RAMP_MS,
  zoomAt,
} from '../../src/shared/composition/timeline';

// The video timeline: clips play back to back, segments live in output time,
// and every edit keeps the timeline consistent.

const SOURCE = { mediaId: '00000000-0000-4000-8000-000000000001', width: 1920, height: 1080 };
const DURATION = 10_000;

const video = (patch: Partial<VideoSettings> = {}): VideoSettings => ({ clips: [{ startMs: 0, endMs: DURATION }], zooms: [], scenes: [], muted: false, ...patch });
const zoom = (id: string, startMs: number, endMs: number): ZoomSegment => ({ id, startMs, endMs, scale: 2, mode: 'manual', x: 0.5, y: 0.5 });

describe('clips', () => {
  it('maps output time across clips played back to back', () => {
    const v = video({ clips: [{ startMs: 1000, endMs: 3000 }, { startMs: 6000, endMs: 7000 }] });
    expect(timelineDuration(v)).toBe(3000);
    expect(sourceTimeAt(v, 500)).toEqual({ clip: 0, sourceMs: 1500 });
    expect(sourceTimeAt(v, 2500)).toEqual({ clip: 1, sourceMs: 6500 });
    expect(sourceTimeAt(v, 9999)).toEqual({ clip: 1, sourceMs: 7000 });
  });

  it('splits at the playhead, and not too close to an edge', () => {
    const split = splitAt(video(), 4000, DURATION);
    expect(split.clips).toEqual([
      { startMs: 0, endMs: 4000 },
      { startMs: 4000, endMs: DURATION },
    ]);
    expect(timelineDuration(split)).toBe(DURATION);
    const tooClose = video();
    expect(splitAt(tooClose, 200, DURATION)).toBe(tooClose);
  });

  it('removing a clip shortens the timeline and refits the segments; the last clip stays', () => {
    const v = video({ clips: [{ startMs: 0, endMs: 4000 }, { startMs: 4000, endMs: DURATION }], zooms: [zoom('a', 1000, 2000), zoom('b', 5000, 9000)] });
    const next = removeClip(v, 1);
    expect(timelineDuration(next)).toBe(4000);
    expect(next.zooms.map((z) => z.id)).toEqual(['a']);
    expect(removeClip(video(), 0).clips).toHaveLength(1);
  });

  it('trims inside the source and keeps the minimum length', () => {
    expect(trimClip(video(), 0, 'start', -500, DURATION).clips[0]).toEqual({ startMs: 0, endMs: DURATION });
    expect(trimClip(video(), 0, 'end', 200, DURATION).clips[0]).toEqual({ startMs: 0, endMs: 500 });
    expect(trimClip(video(), 0, 'end', 20_000, DURATION).clips[0]!.endMs).toBe(DURATION);
  });
});

describe('segments', () => {
  it('a new segment fills a free span around the click, never an occupied one', () => {
    const zooms = [zoom('a', 3000, 5000)];
    expect(newSegmentRange(zooms, 1000, DURATION)).toEqual({ startMs: 0, endMs: 2000 });
    expect(newSegmentRange(zooms, 4000, DURATION)).toBeNull();
    expect(newSegmentRange(zooms, 5600, DURATION)).toEqual({ startMs: 5000, endMs: 7000 });
  });

  it('moving and resizing stop at neighbours and the timeline ends', () => {
    const zooms = [zoom('a', 1000, 2000), zoom('b', 4000, 5000)];
    expect(placeSegment(zooms, 'a', 3500, 4500, DURATION, 'move').find((z) => z.id === 'a')).toMatchObject({ startMs: 3000, endMs: 4000 });
    expect(placeSegment(zooms, 'b', 4000, 12_000, DURATION, 'end').find((z) => z.id === 'b')).toMatchObject({ startMs: 4000, endMs: DURATION });
    expect(placeSegment(zooms, 'b', 500, 5000, DURATION, 'start').find((z) => z.id === 'b')).toMatchObject({ startMs: 2000, endMs: 5000 });
  });

  it('zoom eases in and out over the ramp and holds in between', () => {
    const zooms = [zoom('a', 1000, 4000)];
    expect(zoomAt(zooms, 500).scale).toBe(1);
    expect(zoomAt(zooms, 1000).scale).toBe(1);
    expect(zoomAt(zooms, 1000 + ZOOM_RAMP_MS / 2).scale).toBeCloseTo(1.5, 5);
    expect(zoomAt(zooms, 2500).scale).toBe(2);
    expect(zoomAt(zooms, 4000).scale).toBe(1);
  });

  it('the zoomed crop shrinks around the focus and stays inside the crop', () => {
    const crop = { x: 0, y: 0, width: 1000, height: 500 };
    expect(zoomedSourceCrop(crop, { scale: 2, x: 0.5, y: 0.5 })).toEqual({ x: 250, y: 125, width: 500, height: 250 });
    expect(zoomedSourceCrop(crop, { scale: 2, x: 1, y: 0 })).toEqual({ x: 500, y: 0, width: 500, height: 250 });
    expect(zoomedSourceCrop(crop, { scale: 1, x: 0.2, y: 0.2 })).toBe(crop);
  });
});

describe('composition v2', () => {
  it('upgrades a stored v1 video trim to one clip, and validates', () => {
    const current = defaultComposition(SOURCE, { durationMs: DURATION });
    const v1 = { ...current, v: 1, video: { trimStartMs: 1000, trimEndMs: 8000, muted: true } };
    const upgraded = upgradeComposition(v1) as typeof current;
    expect(upgraded.v).toBe(2);
    expect(upgraded.video).toEqual({ clips: [{ startMs: 1000, endMs: 8000 }], zooms: [], scenes: [], muted: true });
    expect(compositionSchema.safeParse(v1).success).toBe(true);
  });

  it('rejects overlapping zooms', () => {
    const current = defaultComposition(SOURCE, { durationMs: DURATION });
    const bad = { ...current, video: { ...current.video!, zooms: [zoom('a', 0, 3000), zoom('b', 2000, 4000)] } };
    expect(compositionSchema.safeParse(bad).success).toBe(false);
  });

  it('a video export fills the chosen resolution box with even sides', () => {
    const comp = { ...defaultComposition(SOURCE, { durationMs: DURATION }), canvas: { ratio: '16:9' as const, width: 1920, height: 1080 } };
    expect(videoExportLayout(comp, '1080p').canvas).toEqual({ width: 1920, height: 1080 });
    expect(videoExportLayout(comp, '720p').canvas).toEqual({ width: 1280, height: 720 });
    expect(videoExportLayout(comp, '4k').canvas).toEqual({ width: 3840, height: 2160 });
  });
});
