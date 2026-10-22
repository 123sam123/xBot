import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { computeLayout, type Layout } from '../../../shared/composition/layout';
import { outputSize, type Composition } from '../../../shared/composition/model';
import { drawComposition, type CompositionAssets } from './draw';

/** The preview's backing store is capped lower than an export: it only has to look sharp on screen. */
const PREVIEW_MAX_SIDE = 4096;

/**
 * The layout the preview draws at `displayScale` CSS px per 1× px, and the
 * canvas's CSS size. A layout rect × (cssWidth / layout.canvas.width) is its
 * place in CSS px (not ÷ devicePixelRatio: the backing store may be capped).
 */
export function previewLayout(composition: Composition, displayScale: number, dpr: number): { layout: Layout; cssWidth: number; cssHeight: number } {
  const out = outputSize(composition);
  return {
    layout: computeLayout(composition, { scale: displayScale * dpr, maxSide: PREVIEW_MAX_SIDE }),
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

/**
 * The live preview: `drawComposition` at `displayScale` CSS px per 1× output
 * px, times the device pixel ratio, redrawn at most once per frame. A
 * transparent background shows CSS checks behind the canvas, never in it.
 */
export function CompositionCanvas({
  composition,
  assets,
  assetsReady,
  displayScale,
  className,
  style,
  testId,
  hole = false,
}: {
  composition: Composition;
  assets: CompositionAssets;
  /** Every image the composition needs has decoded. */
  assetsReady: boolean;
  displayScale: number;
  className?: string;
  style?: CSSProperties;
  testId?: string;
  /** Draw a video's frame layer: the content is a hole the <video> under the canvas shows through. */
  hole?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dpr = useDevicePixelRatio();
  const scale = displayScale * dpr;
  const out = outputSize(composition);
  const key = drawKey(composition, scale);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = canvas.current;
      if (!el) return;
      const { layout } = previewLayout(composition, displayScale, dpr);
      if (el.width !== layout.canvas.width) el.width = layout.canvas.width;
      if (el.height !== layout.canvas.height) el.height = layout.canvas.height;
      const ctx = el.getContext('2d');
      if (!ctx) return;
      drawComposition(ctx, composition, layout, assets, { hole });
      el.dataset.drawnKey = assetsReady ? key : '';
    });
    return () => cancelAnimationFrame(frame);
  }, [composition, assets, assetsReady, displayScale, dpr, key, hole]);

  return (
    <canvas
      ref={canvas}
      // CSS checks behind a hole would cover the video under it; a video can't be transparent anyway.
      className={['composition-canvas', composition.background.type === 'transparent' && !hole && 'composition-canvas-transparent', className]
        .filter(Boolean)
        .join(' ')}
      style={{ width: out.width * displayScale, height: out.height * displayScale, ...style }}
      data-want-key={key}
      data-assets-ready={assetsReady}
      data-testid={testId}
    />
  );
}
