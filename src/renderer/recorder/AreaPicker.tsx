import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CaptureRect } from '../../shared/contracts/recordings';

// The area overlay: the display dims, a drag draws the area (its size shows
// as you go), Enter or "Record this area" confirms, Escape cancels. The rect
// is in points relative to the display, as the native recorder wants it.

const MIN = 64;

export function AreaPicker() {
  const [rect, setRect] = useState<CaptureRect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const answer = (value: CaptureRect | null) => {
    setRect(null);
    void window.xbot.recordings.areaPicked(value);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') answer(null);
      else if (event.key === 'Enter' && rect && rect.width >= MIN && rect.height >= MIN) answer(rect);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rect]);

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    setRect({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
  };
  const move = (event: ReactPointerEvent) => {
    const from = start.current;
    if (!from) return;
    setRect({ x: Math.min(from.x, event.clientX), y: Math.min(from.y, event.clientY), width: Math.abs(event.clientX - from.x), height: Math.abs(event.clientY - from.y) });
  };
  const up = () => {
    start.current = null;
    setDragging(false);
  };

  const ready = rect !== null && rect.width >= MIN && rect.height >= MIN;
  return (
    <div className="area-overlay" onPointerDown={down} onPointerMove={move} onPointerUp={up} data-testid="area-overlay">
      {!rect && <p className="area-hint">Drag to select the area to record · Esc to cancel</p>}
      {rect && (
        <div className="area-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <span className="area-size">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
          {ready && !dragging && (
            <span className="area-actions">
              <button type="button" className="area-cancel" onClick={() => answer(null)}>
                Cancel
              </button>
              <button type="button" className="area-confirm" onClick={() => answer(rect)}>
                Record this area
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
