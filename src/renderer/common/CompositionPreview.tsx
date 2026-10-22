import { useEffect, useMemo, useRef, useState } from 'react';
import { outputSize, type Composition } from '../../shared/composition/model';
import { createBitmapCache } from './composition/assets';
import { CompositionCanvas } from './composition/CompositionCanvas';
import './composition/composition.css';

export interface CompositionSource {
  url: string;
  width: number;
  height: number;
  alt: string;
}

const bitmaps = createBitmapCache();

/**
 * A composition drawn to fill its box, with the same canvas renderer as the
 * Studio: `contain` shows all of it, `cover` fills the box and trims the
 * overflow. For thumbnails; the Studio sizes its own canvas.
 */
export function CompositionPreview({
  composition,
  source,
  fit = 'contain',
  className,
  testId,
}: {
  composition: Composition;
  source: CompositionSource;
  fit?: 'contain' | 'cover';
  className?: string;
  testId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    bitmaps.get(source.url, source.url).then(
      (decoded) => alive && setBitmap(decoded),
      (err: unknown) => console.error('composition preview: could not load the source', err),
    );
    return () => {
      alive = false;
    };
  }, [source.url]);

  const assets = useMemo(() => ({ source: bitmap, background: null }), [bitmap]);
  const out = outputSize(composition);
  const pick = fit === 'cover' ? Math.max : Math.min;
  const displayScale = size ? pick(size.width / out.width, size.height / out.height) : 0;

  return (
    <div ref={box} className={['composition-box', className].filter(Boolean).join(' ')} role="img" aria-label={source.alt} data-testid={testId}>
      {displayScale > 0 && <CompositionCanvas composition={composition} assets={assets} assetsReady={bitmap !== null} displayScale={displayScale} />}
    </div>
  );
}
