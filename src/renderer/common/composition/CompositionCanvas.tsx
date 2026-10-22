import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { computeLayout, type Layout } from '../../../shared/composition/layout';
import { outputSize, type Composition } from '../../../shared/composition/model';
import { zoomAt } from '../../../shared/composition/timeline';
import type { Clock } from './clock';
import { drawComposition, type CompositionAssets } from './draw';

/** The preview's backing store is capped lower than an export: it only has to look sharp on screen. */
const PREVIEW_MAX_SIDE = 4096;

/**
 * The layout the preview draws at `displayScale` CSS px per 1× px, and the
 * canvas's CSS size. `quality` below 1 draws a smaller backing store (the
 * Preview quality menu's Half).
 */
export function previewLayout(composition: Composition, displayScale: number, dpr: number, quality = 1): { layout: Layout; cssWidth: number; cssHeight: number } {
  const out = outputSize(composition);
  return {
    layout: computeLayout(composition, { scale: displayScale * dpr * quality, maxSide: PREVIEW_MAX_SIDE }),
    cssWidth: out.width * displayScale,
    cssHeight: out.height * displayScale,
  };
}

export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [dpr]);
  return dpr;
}

/** A short, stable key for what a draw shows: tests wait until the drawn key equals the wanted one. */
function drawKey(composition: Composition, scale: number): string {
  const text = `${scale}|${JSON.stringify(composition)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

/** A video source for the preview: its element (the frame shown) and the playhead (the zoom at that moment). */
export interface CanvasVideo {
  element: HTMLVideoElement | null;
  clock: Clock;
}

/**
 * The live preview: `drawComposition` at `displayScale` CSS px per 1× output
 * px, times the device pixel ratio, redrawn at most once per frame. A video
 * redraws whenever the playhead moves or a new frame is ready. A transparent
 * background shows CSS checks behind the canvas, never in it.
 */
export function CompositionCanvas({
  composition,
  assets,
  assetsReady,
  displayScale,
  video,
  quality = 1,
  className,
  style,
  testId,
}: {
  composition: Composition;
  assets: CompositionAssets;
  /** Every image the composition needs has decoded. */
  assetsReady: boolean;
  displayScale: number;
  video?: CanvasVideo;
  quality?: number;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dpr = useDevicePixelRatio();
  const scale = displayScale * dpr * quality;
  const out = outputSize(composition);
  const key = drawKey(composition, scale);
  const element = video?.element ?? null;
  const clock = video?.clock ?? null;

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = 0;
      const el = canvas.current;
      if (!el) return;
      const { layout } = previewLayout(composition, displayScale, dpr, quality);
      if (el.width !== layout.canvas.width) el.width = layout.canvas.width;
      if (el.height !== layout.canvas.height) el.height = layout.canvas.height;
      const ctx = el.getContext('2d');
      if (!ctx) return;
      const videoReady = element !== null && element.readyState >= 2;
      const zoom = composition.video && clock ? zoomAt(composition.video.zooms, clock.get()) : undefined;
      drawComposition(ctx, composition, layout, assets, { frame: videoReady ? element : null, zoom });
      el.dataset.drawnKey = assetsReady && (!composition.video || videoReady) ? key : '';
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    schedule();
    const offClock = clock?.subscribe(schedule);
    const events = ['loadeddata', 'seeked', 'timeupdate'] as const;
    for (const name of events) element?.addEventListener(name, schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      offClock?.();
      for (const name of events) element?.removeEventListener(name, schedule);
    };
  }, [composition, assets, assetsReady, displayScale, dpr, quality, key, element, clock]);

  return (
    <canvas
      ref={canvas}
      className={['composition-canvas', composition.background.type === 'transparent' && 'composition-canvas-transparent', className].filter(Boolean).join(' ')}
      style={{ width: out.width * displayScale, height: out.height * displayScale, ...style }}
      data-want-key={key}
      data-assets-ready={assetsReady}
      data-testid={testId}
    />
  );
}
