import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefCallback } from 'react';
import type { VideoSettings } from '../../shared/composition/model';

// Plays a video document's <video> inside its trim: play starts at the
// playhead (or at the trim start when the playhead is outside the trim) and
// pauses at the trim end, where the playhead stays. The element can come and
// go (crop mode swaps it out), so it is tracked through a callback ref.

/** A frame's worth of slack at the trim end. */
const END_SLACK_S = 0.03;

export interface VideoPlayback {
  /** Attach to the stage's <video>. */
  ref: RefCallback<HTMLVideoElement>;
  /** Seconds. */
  current: number;
  playing: boolean;
  /** The element failed to load or decode: its codec can't play here. */
  failed: boolean;
  toggle(): void;
  pause(): void;
  seek(seconds: number): void;
}

export function useVideoPlayback(video: VideoSettings | undefined, durationMs: number, hasAudio: boolean): VideoPlayback {
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  const [current, setCurrent] = useState((video?.trimStartMs ?? 0) / 1000);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const trim = useRef({ start: 0, end: durationMs / 1000 });
  const trimStart = (video?.trimStartMs ?? 0) / 1000;
  const trimEnd = (video?.trimEndMs ?? durationMs) / 1000;
  useLayoutEffect(() => {
    trim.current = { start: trimStart, end: trimEnd };
  }, [trimStart, trimEnd]);

  const ref = useCallback<RefCallback<HTMLVideoElement>>((el) => setElement(el), []);

  // What the preview plays is what the export keeps.
  const muted = (video?.muted ?? false) || !hasAudio;
  useEffect(() => {
    if (element) element.muted = muted;
  }, [element, muted]);

  useEffect(() => {
    if (!element) return;
    const sync = () => setCurrent(element.currentTime);
    const onLoaded = () => {
      setFailed(false);
      const { start, end } = trim.current;
      if (element.currentTime < start || element.currentTime > end) element.currentTime = start;
      sync();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => setFailed(true);
    element.addEventListener('loadedmetadata', onLoaded);
    element.addEventListener('seeked', sync);
    element.addEventListener('timeupdate', sync);
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('error', onError);
    // Already loaded before these listeners: catch up on the next frame.
    const catchUp = element.readyState >= 1 ? requestAnimationFrame(onLoaded) : 0;
    return () => {
      cancelAnimationFrame(catchUp);
      element.removeEventListener('loadedmetadata', onLoaded);
      element.removeEventListener('seeked', sync);
      element.removeEventListener('timeupdate', sync);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('error', onError);
    };
  }, [element]);

  // While playing: a smooth playhead, and a stop at the trim end.
  useEffect(() => {
    if (!element || !playing) return;
    let frame = requestAnimationFrame(function tick() {
      const { end } = trim.current;
      if (element.currentTime >= end - END_SLACK_S) {
        element.pause();
        element.currentTime = end;
      }
      setCurrent(element.currentTime);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [element, playing]);

  const pause = useCallback(() => element?.pause(), [element]);

  const toggle = useCallback(() => {
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    const { start, end } = trim.current;
    if (element.currentTime < start || element.currentTime >= end - END_SLACK_S) element.currentTime = start;
    element.play().catch((err: unknown) => console.warn('studio: video did not play', err));
  }, [element]);

  const seek = useCallback(
    (seconds: number) => {
      const clamped = Math.min(durationMs / 1000, Math.max(0, seconds));
      setCurrent(clamped);
      if (element) element.currentTime = clamped;
    },
    [element, durationMs],
  );

  // A stage that went away (crop mode) isn't playing, whatever its last event said.
  return { ref, current, playing: element !== null && playing, failed: element !== null && failed, toggle, pause, seek };
}
