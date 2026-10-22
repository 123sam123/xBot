import { minTrimMs, ZOOM_LIMITS, type Clip, type SceneMode, type SceneSegment, type VideoSettings, type ZoomSegment } from './model';

// The video timeline, pure and zod-free. Clips are source ranges played back
// to back; output time ("timeline ms") runs over them in order. Zoom and scene
// segments live in output time, never overlap within their track, and stay
// inside the timeline.

/** How long a zoom eases in and out. */
export const ZOOM_RAMP_MS = 400;
/** The shortest zoom or scene segment. */
export const MIN_SEGMENT_MS = 300;
/** A new zoom's length when there is room. */
export const DEFAULT_SEGMENT_MS = 2000;

export const clipLength = (clip: Clip) => clip.endMs - clip.startMs;

export function timelineDuration(video: Pick<VideoSettings, 'clips'>): number {
  return video.clips.reduce((sum, clip) => sum + clipLength(clip), 0);
}

/** Where output time `tMs` falls: the clip, and the source time there. Past the end, the last clip's end. */
export function sourceTimeAt(video: Pick<VideoSettings, 'clips'>, tMs: number): { clip: number; sourceMs: number } {
  let start = 0;
  for (let i = 0; i < video.clips.length; i++) {
    const clip = video.clips[i]!;
    const length = clipLength(clip);
    if (tMs < start + length || i === video.clips.length - 1) {
      return { clip: i, sourceMs: clip.startMs + Math.min(length, Math.max(0, tMs - start)) };
    }
    start += length;
  }
  return { clip: 0, sourceMs: 0 };
}

/** The output time at which clip `index` starts. */
export function clipStartTime(video: Pick<VideoSettings, 'clips'>, index: number): number {
  let start = 0;
  for (let i = 0; i < index; i++) start += clipLength(video.clips[i]!);
  return start;
}

/** Keeps every segment inside `[0, total]` and at least MIN_SEGMENT_MS long; drops the ones that can't be. */
function fitSegments<T extends { startMs: number; endMs: number }>(segments: T[], total: number): T[] {
  return segments
    .map((segment) => ({ ...segment, startMs: Math.max(0, segment.startMs), endMs: Math.min(total, segment.endMs) }))
    .filter((segment) => segment.endMs - segment.startMs >= Math.min(MIN_SEGMENT_MS, total));
}

/** The video with its segments refitted after the clips changed. */
function withClips(video: VideoSettings, clips: Clip[]): VideoSettings {
  const total = timelineDuration({ clips });
  return { ...video, clips, zooms: fitSegments(video.zooms, total), scenes: fitSegments(video.scenes, total) };
}

/** Splits the clip under `tMs` there; a no-op when either half would be shorter than the minimum. */
export function splitAt(video: VideoSettings, tMs: number, sourceDurationMs: number): VideoSettings {
  const { clip: index, sourceMs } = sourceTimeAt(video, tMs);
  const clip = video.clips[index]!;
  const min = minTrimMs(sourceDurationMs);
  if (sourceMs - clip.startMs < min || clip.endMs - sourceMs < min) return video;
  const clips = [...video.clips];
  clips.splice(index, 1, { startMs: clip.startMs, endMs: Math.round(sourceMs) }, { startMs: Math.round(sourceMs), endMs: clip.endMs });
  return { ...video, clips };
}

/** Removes clip `index`; the last clip can't be removed. */
export function removeClip(video: VideoSettings, index: number): VideoSettings {
  if (video.clips.length <= 1) return video;
  return withClips(video, video.clips.filter((_, i) => i !== index));
}

/** Moves one edge of clip `index` to `sourceMs`, inside the source and at least the minimum long. */
export function trimClip(video: VideoSettings, index: number, edge: 'start' | 'end', sourceMs: number, sourceDurationMs: number): VideoSettings {
  const clip = video.clips[index];
  if (!clip) return video;
  const min = minTrimMs(sourceDurationMs);
  const next =
    edge === 'start'
      ? { ...clip, startMs: Math.round(Math.min(clip.endMs - min, Math.max(0, sourceMs))) }
      : { ...clip, endMs: Math.round(Math.max(clip.startMs + min, Math.min(sourceDurationMs, sourceMs))) };
  const clips = [...video.clips];
  clips[index] = next;
  return withClips(video, clips);
}

type Segment = { id: string; startMs: number; endMs: number };

/** The free span around `tMs` in a track, or null when `tMs` is inside a segment. */
function freeSpan(segments: readonly Segment[], tMs: number, total: number): { from: number; to: number } | null {
  let from = 0;
  let to = total;
  for (const segment of segments) {
    if (tMs >= segment.startMs && tMs < segment.endMs) return null;
    if (segment.endMs <= tMs) from = Math.max(from, segment.endMs);
    if (segment.startMs > tMs) to = Math.min(to, segment.startMs);
  }
  return { from, to };
}

/** Where a new segment at `tMs` goes: DEFAULT_SEGMENT_MS long when there is room, else the whole gap. */
export function newSegmentRange(segments: readonly Segment[], tMs: number, total: number): { startMs: number; endMs: number } | null {
  const span = freeSpan(segments, tMs, total);
  if (!span || span.to - span.from < MIN_SEGMENT_MS) return null;
  const length = Math.min(DEFAULT_SEGMENT_MS, span.to - span.from);
  const startMs = Math.min(Math.max(span.from, tMs - length / 2), span.to - length);
  return { startMs: Math.round(startMs), endMs: Math.round(startMs + length) };
}

/**
 * Sets segment `id`'s range, clamped against its neighbours and the timeline.
 * `mode` says what moved: the whole segment keeps its length; an edge keeps
 * the other edge.
 */
export function placeSegment<T extends Segment>(segments: readonly T[], id: string, startMs: number, endMs: number, total: number, mode: 'move' | 'start' | 'end'): T[] {
  const target = segments.find((segment) => segment.id === id);
  if (!target) return [...segments];
  let lo = 0;
  let hi = total;
  for (const segment of segments) {
    if (segment.id === id) continue;
    if (segment.endMs <= target.startMs) lo = Math.max(lo, segment.endMs);
    if (segment.startMs >= target.endMs) hi = Math.min(hi, segment.startMs);
  }
  let start = startMs;
  let end = endMs;
  if (mode === 'move') {
    const length = target.endMs - target.startMs;
    start = Math.min(Math.max(lo, startMs), hi - length);
    end = start + length;
  } else if (mode === 'start') {
    start = Math.min(Math.max(lo, startMs), target.endMs - MIN_SEGMENT_MS);
    end = target.endMs;
  } else {
    start = target.startMs;
    end = Math.max(Math.min(hi, endMs), target.startMs + MIN_SEGMENT_MS);
  }
  return segments.map((segment) => (segment.id === id ? { ...segment, startMs: Math.round(start), endMs: Math.round(end) } : segment));
}

export function newZoom(id: string, range: { startMs: number; endMs: number }): ZoomSegment {
  return { id, ...range, scale: 2, mode: 'manual', x: 0.5, y: 0.5 };
}

export function newScene(id: string, range: { startMs: number; endMs: number }): SceneSegment {
  return { id, ...range, mode: 'cameraFull' };
}

export const clampZoomScale = (scale: number) => Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, scale));

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export interface ZoomState {
  /** 1 is no zoom. */
  scale: number;
  /** An automatic zoom's focus follows the cursor; `x`/`y` are where it started. */
  mode?: 'auto' | 'manual';
  /** The focus, fractions of the content. */
  x: number;
  y: number;
}

/** The zoom at output time `tMs`: eased in over the first ZOOM_RAMP_MS of a segment and out over its last. */
export function zoomAt(zooms: readonly ZoomSegment[], tMs: number): ZoomState {
  for (const zoom of zooms) {
    if (tMs < zoom.startMs || tMs > zoom.endMs) continue;
    const ramp = Math.min(ZOOM_RAMP_MS, (zoom.endMs - zoom.startMs) / 2);
    const amount = easeInOut(Math.min(1, (tMs - zoom.startMs) / ramp, (zoom.endMs - tMs) / ramp));
    return { scale: 1 + (zoom.scale - 1) * amount, x: zoom.x, y: zoom.y, mode: zoom.mode };
  }
  return { scale: 1, x: 0.5, y: 0.5 };
}

/** How long a scene change animates. */
export const SCENE_RAMP_MS = 350;

export interface SceneState {
  mode: SceneMode;
  /** 0 → 1 as the scene eases in at its start and back out at its end. */
  amount: number;
}

/** The scene at output time `tMs`, or null for the default (screen with the camera bubble). */
export function sceneAt(scenes: readonly SceneSegment[], tMs: number): SceneState | null {
  for (const scene of scenes) {
    if (tMs < scene.startMs || tMs > scene.endMs) continue;
    const ramp = Math.min(SCENE_RAMP_MS, (scene.endMs - scene.startMs) / 2);
    return { mode: scene.mode, amount: easeInOut(Math.min(1, (tMs - scene.startMs) / ramp, (scene.endMs - tMs) / ramp)) };
  }
  return null;
}

/** Where source time `sourceMs` plays on the timeline (its first clip), or null when no clip keeps it. */
export function timelineTimeOf(video: Pick<VideoSettings, 'clips'>, sourceMs: number): number | null {
  let start = 0;
  for (const clip of video.clips) {
    if (sourceMs >= clip.startMs && sourceMs <= clip.endMs) return start + (sourceMs - clip.startMs);
    start += clipLength(clip);
  }
  return null;
}

/** Recording-time segments placed on the timeline; a segment that a cut splits or removes is dropped. */
export function segmentsOnTimeline<T extends { startMs: number; endMs: number }>(video: VideoSettings, segments: readonly T[]): T[] {
  const placed: T[] = [];
  for (const segment of segments) {
    const start = timelineTimeOf(video, segment.startMs);
    const end = timelineTimeOf(video, segment.endMs);
    if (start === null || end === null || end - start < MIN_SEGMENT_MS || Math.abs(end - start - (segment.endMs - segment.startMs)) > 1) continue;
    placed.push({ ...segment, startMs: Math.round(start), endMs: Math.round(end) });
  }
  return placed;
}
