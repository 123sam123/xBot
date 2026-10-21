import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { clampCrop, type Rect, type SourceRef } from '../../shared/composition/model';
import { CROP_HANDLES, dragCrop, type CropHandle } from './crop';

/** Room around the source inside the canvas area, CSS px. */
const INSET = 24;

/**
 * Crop mode: the whole source, fitted to the canvas area, dimmed outside the
 * crop rect. The rect moves by dragging it and resizes by its eight handles;
 * nothing is changed until Apply.
 */
export function CropOverlay({
  overlayRef,
  url,
  source,
  crop,
  ratio,
  onChange,
}: {
  overlayRef: RefObject<HTMLDivElement | null>;
  url: string;
  source: Pick<SourceRef, 'width' | 'height'>;
  crop: Rect;
  /** The aspect lock in source px, or null for free. */
  ratio: number | null;
  onChange(crop: Rect): void;
}) {
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const drag = useRef<{ handle: CropHandle; x: number; y: number; start: Rect } | null>(null);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const measure = () => setArea({ width: el.clientWidth, height: el.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [overlayRef]);

  const scale = area ? Math.max(0.0001, Math.min((area.width - 2 * INSET) / source.width, (area.height - 2 * INSET) / source.height)) : 0;
  const image = { width: source.width * scale, height: source.height * scale };

  const begin = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const handle = (event.currentTarget.dataset.handle ?? 'move') as CropHandle;
    drag.current = { handle, x: event.clientX, y: event.clientY, start: crop };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || image.width === 0) return;
    const dx = (event.clientX - current.x) / image.width;
    const dy = (event.clientY - current.y) / image.height;
    onChange(clampCrop(dragCrop(current.start, current.handle, dx, dy, ratio, source), source));
  };
  const end = () => {
    drag.current = null;
  };

  const rect: CSSProperties = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.width * 100}%`,
    height: `${crop.height * 100}%`,
  };

  return (
    <div ref={overlayRef} className="crop-overlay" data-testid="crop-overlay">
      {scale > 0 && (
        <div className="crop-stage" style={{ width: image.width, height: image.height }}>
          <img className="crop-image" src={url} alt="" draggable={false} />
          <div
            className="crop-rect"
            style={rect}
            data-testid="crop-rect"
            data-handle="move"
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <span className="crop-grid" aria-hidden="true" />
            {CROP_HANDLES.map((handle) => (
              <span
                key={handle}
                className={`crop-handle crop-handle-${handle}`}
                data-testid={`crop-handle-${handle}`}
                data-handle={handle}
                onPointerDown={begin}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
