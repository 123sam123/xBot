import type { CursorSettings } from '../composition/model';
import type { CursorSample, CursorTrack } from './track';

// How a recording's cursor moves when the editor draws it, pure and zod-free
// (the preview and the export draw from the same numbers). The raw track is
// resampled through a critically damped spring for smooth movement, and
// through a slower one for the camera's focus during an automatic zoom. Clicks,
// presses and idle spans come from the raw samples.

/** Path resolution, ms. */
const STEP_MS = 1000 / 120;
/** The cursor's spring: quick, no overshoot. */
const CURSOR_SPRING = { stiffness: 260, damping: 32 };
/** The zoom focus's spring: slow and calm, so the camera glides. */
const FOCUS_SPRING = { stiffness: 22, damping: 9.4 };
/** Moving less than this (a fraction of the frame) between samples isn't movement. */
const STILL = 0.0008;
const IDLE_AFTER_MS = 1500;
const IDLE_FADE_MS = 350;
export const CLICK_RIPPLE_MS = 450;
/** How long a press shrinks the cursor at most (a held drag shouldn't stay small). */
const PRESS_MAX_MS = 260;

export interface MotionPath {
  /** Samples every STEP_MS from 0. */
  xs: Float32Array;
  ys: Float32Array;
}

export interface CursorMotion {
  track: CursorTrack;
  smooth: MotionPath;
  focus: MotionPath;
  /** For each raw sample, the time of the last movement at or before it. */
  lastMove: Float64Array;
  /** Mouse-downs. */
  clicks: { t: number; x: number; y: number }[];
}

/** The last sample at or before `ms` by binary search; -1 before the first. */
export function sampleIndex(samples: readonly CursorSample[], ms: number): number {
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

/** The raw cursor at `ms`: straight lines between samples. */
export function rawCursorAt(track: CursorTrack, ms: number): { x: number; y: number; cursor: number } | null {
  const { samples } = track;
  if (samples.length === 0) return null;
  const index = sampleIndex(samples, ms);
  if (index < 0) return { x: samples[0]!.x, y: samples[0]!.y, cursor: samples[0]!.cursor };
  const a = samples[index]!;
  const b = samples[index + 1];
  if (!b || b.t <= a.t) return { x: a.x, y: a.y, cursor: a.cursor };
  const k = Math.min(1, (ms - a.t) / (b.t - a.t));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, cursor: a.cursor };
}

/** The raw track followed by a damped spring, sampled every STEP_MS until the movement settles. */
export function springPath(track: CursorTrack, { stiffness, damping }: { stiffness: number; damping: number }): MotionPath {
  const { samples } = track;
  const end = (samples.at(-1)?.t ?? 0) + 2000;
  const count = Math.max(1, Math.ceil(end / STEP_MS) + 1);
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const first = samples[0];
  let x = first?.x ?? 0.5;
  let y = first?.y ?? 0.5;
  let vx = 0;
  let vy = 0;
  const dt = STEP_MS / 1000;
  for (let i = 0; i < count; i++) {
    const target = rawCursorAt(track, i * STEP_MS);
    if (target) {
      // Semi-implicit Euler: stable at this step for these springs.
      vx += (stiffness * (target.x - x) - damping * vx) * dt;
      vy += (stiffness * (target.y - y) - damping * vy) * dt;
      x += vx * dt;
      y += vy * dt;
    }
    xs[i] = x;
    ys[i] = y;
  }
  return { xs, ys };
}

/** A path's position and velocity (fractions per second) at `ms`. */
export function pathAt(path: MotionPath, ms: number): { x: number; y: number; vx: number; vy: number } {
  const last = path.xs.length - 1;
  const f = Math.min(last, Math.max(0, ms / STEP_MS));
  const i = Math.min(last - 1, Math.floor(f));
  if (i < 0) return { x: path.xs[0]!, y: path.ys[0]!, vx: 0, vy: 0 };
  const k = f - i;
  const x = path.xs[i]! + (path.xs[i + 1]! - path.xs[i]!) * k;
  const y = path.ys[i]! + (path.ys[i + 1]! - path.ys[i]!) * k;
  const vx = ((path.xs[i + 1]! - path.xs[i]!) * 1000) / STEP_MS;
  const vy = ((path.ys[i + 1]! - path.ys[i]!) * 1000) / STEP_MS;
  return { x, y, vx, vy };
}

export function createMotion(track: CursorTrack): CursorMotion {
  const { samples } = track;
  const lastMove = new Float64Array(samples.length);
  let moved = samples[0]?.t ?? 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const prev = samples[i - 1];
    if (!prev || Math.hypot(s.x - prev.x, s.y - prev.y) > STILL || s.type !== 0) moved = s.t;
    lastMove[i] = moved;
  }
  return {
    track,
    smooth: springPath(track, CURSOR_SPRING),
    focus: springPath(track, FOCUS_SPRING),
    lastMove,
    clicks: samples.filter((s) => s.type === 1).map((s) => ({ t: s.t, x: s.x, y: s.y })),
  };
}

export interface CursorFrame {
  /** Fractions of the captured frame. */
  x: number;
  y: number;
  cursor: number;
  /** 0–1: fades out while idle. */
  opacity: number;
  /** Radians, clockwise: leaning into horizontal movement. */
  rotation: number;
  /** 1, or less while the button is down. */
  scale: number;
  /** Click ripples showing now: where, and how far along (0–1). */
  ripples: { x: number; y: number; progress: number }[];
}

/** Everything the editor needs to draw the cursor at recording time `ms`. */
export function cursorFrame(motion: CursorMotion, ms: number, settings: CursorSettings): CursorFrame | null {
  const raw = rawCursorAt(motion.track, ms);
  if (!raw) return null;
  const smooth = pathAt(motion.smooth, ms);
  const position = settings.smooth ? smooth : raw;

  let opacity = 1;
  if (settings.hideWhenIdle) {
    const index = sampleIndex(motion.track.samples, ms);
    const idle = index < 0 ? 0 : ms - motion.lastMove[index]!;
    opacity = 1 - Math.min(1, Math.max(0, (idle - IDLE_AFTER_MS) / IDLE_FADE_MS));
  }

  const rotation = settings.tilt * Math.max(-0.45, Math.min(0.45, smooth.vx * 0.35));

  let scale = 1;
  const ripples: CursorFrame['ripples'] = [];
  for (const click of motion.clicks) {
    if (click.t > ms) break;
    const since = ms - click.t;
    if (since < PRESS_MAX_MS) scale = Math.min(scale, 1 - 0.18 * Math.sin((since / PRESS_MAX_MS) * Math.PI));
    if (settings.clickEffect && since < CLICK_RIPPLE_MS) ripples.push({ x: click.x, y: click.y, progress: since / CLICK_RIPPLE_MS });
  }
  return { x: position.x, y: position.y, cursor: raw.cursor, opacity, rotation, scale, ripples };
}

/** Where an automatic zoom looks at `ms`: the cursor through the slow spring. */
export function focusAt(motion: CursorMotion, ms: number): { x: number; y: number } {
  const { x, y } = pathAt(motion.focus, ms);
  return { x, y };
}
