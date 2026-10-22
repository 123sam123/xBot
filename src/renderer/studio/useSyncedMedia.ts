import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react';
import type { VideoSettings } from '../../shared/composition/model';
import { sourceTimeAt } from '../../shared/composition/timeline';
import type { Clock } from '../common/composition/clock';

// Keeps one of a recording's other media elements (the camera <video>, an
// audio track's <audio>) on the screen video's time: it plays while the
// timeline plays, and follows every seek and clip jump. It started `offsetMs`
// into the recording.

/** Further apart than this while playing, the camera seeks back into step. */
const DRIFT_S = 0.15;

export function useSyncedMedia<T extends HTMLMediaElement>(video: VideoSettings | undefined, clock: Clock, playing: boolean, offsetMs: number | null): { ref: RefCallback<T>; element: T | null } {
  const [element, setElement] = useState<T | null>(null);
  const current = useRef<T | null>(null);
  const ref = useCallback<RefCallback<T>>((el) => {
    current.current = el;
    setElement(el);
  }, []);

  useEffect(() => {
    const el = current.current;
    if (!element || !el || !video || offsetMs === null) return;
    const sync = () => {
      const target = (sourceTimeAt(video, clock.get()).sourceMs - offsetMs) / 1000;
      const inside = target >= 0 && (!Number.isFinite(el.duration) || target <= el.duration);
      if (playing && inside) {
        if (Math.abs(el.currentTime - target) > DRIFT_S) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        const clamped = Math.max(0, target);
        if (Math.abs(el.currentTime - clamped) > 0.02) el.currentTime = clamped;
      }
    };
    sync();
    return clock.subscribe(sync);
  }, [element, video, clock, playing, offsetMs]);

  return { ref, element };
}
