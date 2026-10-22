import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { computeLayout } from '../../../shared/composition/layout';
import { outputSize, type Composition } from '../../../shared/composition/model';
import { drawComposition, type CompositionAssets } from './draw';

/** The preview's backing store is capped lower than an export: it only has to look sharp on screen. */
const PREVIEW_MAX_SIDE = 4096;

function useDevicePixelRatio(): number {
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
}: {
  composition: Composition;
  assets: CompositionAssets;
  /** Every image the composition needs has decoded. */
  assetsReady: boolean;
  displayScale: number;
  className?: string;
  style?: CSSProperties;
  testId?: string;
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
      const layout = computeLayout(composition, { scale, maxSide: PREVIEW_MAX_SIDE });
      if (el.width !== layout.canvas.width) el.width = layout.canvas.width;
      if (el.height !== layout.canvas.height) el.height = layout.canvas.height;
      const ctx = el.getContext('2d');
      if (!ctx) return;
      drawComposition(ctx, composition, layout, assets);
      el.dataset.drawnKey = assetsReady ? key : '';
    });
    return () => cancelAnimationFrame(frame);
  }, [composition, assets, assetsReady, scale, key]);

  return (
    <canvas
      ref={canvas}
      className={['composition-canvas', composition.background.type === 'transparent' && 'composition-canvas-transparent', className]
        .filter(Boolean)
        .join(' ')}
      style={{ width: out.width * displayScale, height: out.height * displayScale, ...style }}
      data-want-key={key}
      data-assets-ready={assetsReady}
      data-testid={testId}
    />
  );
}
