import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefCallback } from 'react';
import { createClock, type Clock } from '../common/composition/clock';
import type { VideoSettings } from '../../shared/composition/model';
import { clipStartTime, sourceTimeAt, timelineDuration } from '../../shared/composition/timeline';

// Plays a video document's timeline on one (hidden) <video>: clip after clip,
// jumping the element to each clip's start, and stopping at the end. The
// playhead is output time on `clock`; the canvas draws whatever frame the
// element shows. The element can come and go, so it is a callback ref.

/** A frame's worth of slack at a clip's end. */
const END_SLACK_S = 0.03;

export interface TimelinePlayback {
  ref: RefCallback<HTMLVideoElement>;
  element: HTMLVideoElement | null;
  /** Output ms. */
  clock: Clock;
  playing: boolean;
  /** The element failed to load or decode. */
  failed: boolean;
  toggle(): void;
  pause(): void;
  /** Moves the playhead to output ms `tMs`. */
  seek(tMs: number): void;
}

export function useTimelinePlayback(video: VideoSettings | undefined, hasAudio: boolean): TimelinePlayback {
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const clock = useMemo(() => createClock(), []);
  const settings = useRef<VideoSettings | undefined>(video);
  /** The clip being played; source ranges may repeat, so the element's time alone doesn't say. */
  const clipIndex = useRef(0);

  useLayoutEffect(() => {
    settings.current = video;
    if (!video) return;
    // Edits can shorten the timeline under the playhead.
    const total = timelineDuration(video);
    if (clock.get() > total) clock.set(total);
  }, [video, clock]);

  const ref = useCallback<RefCallback<HTMLVideoElement>>((el) => setElement(el), []);

  const muted = (video?.muted ?? false) || !hasAudio;
  useEffect(() => {
    if (element) element.muted = muted;
  }, [element, muted]);

  /** Shows output time `tMs` on the element. */
  const place = useCallback(
    (tMs: number) => {
      const current = settings.current;
      if (!current) return;
      const { clip, sourceMs } = sourceTimeAt(current, tMs);
      clipIndex.current = clip;
      clock.set(tMs);
      if (element && Math.abs(element.currentTime - sourceMs / 1000) > 0.001) element.currentTime = sourceMs / 1000;
    },
    [element, clock],
  );

  useEffect(() => {
    if (!element) return;
    const onLoaded = () => {
      setFailed(false);
      place(clock.get());
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => setFailed(true);
    element.addEventListener('loadedmetadata', onLoaded);
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('error', onError);
    const catchUp = element.readyState >= 1 ? requestAnimationFrame(onLoaded) : 0;
    return () => {
      cancelAnimationFrame(catchUp);
      element.removeEventListener('loadedmetadata', onLoaded);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('error', onError);
    };
  }, [element, place, clock]);

  // While playing: follow the element, hop from clip to clip, stop at the end.
  useEffect(() => {
    if (!element || !playing) return;
    let frame = requestAnimationFrame(function tick() {
      const current = settings.current;
      if (current) {
        const index = Math.min(clipIndex.current, current.clips.length - 1);
        const clip = current.clips[index]!;
        const source = element.currentTime;
        if (source >= clip.endMs / 1000 - END_SLACK_S) {
          if (index + 1 < current.clips.length) {
            clipIndex.current = index + 1;
            element.currentTime = current.clips[index + 1]!.startMs / 1000;
            clock.set(clipStartTime(current, index + 1));
          } else {
            element.pause();
            clock.set(timelineDuration(current));
          }
        } else {
          clock.set(clipStartTime(current, index) + Math.max(0, source * 1000 - clip.startMs));
        }
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [element, playing, clock]);

  const pause = useCallback(() => element?.pause(), [element]);

  const toggle = useCallback(() => {
    const current = settings.current;
    if (!element || !current) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    if (clock.get() >= timelineDuration(current) - END_SLACK_S * 1000) place(0);
    element.play().catch((err: unknown) => console.warn('studio: video did not play', err));
  }, [element, clock, place]);

  const seek = useCallback(
    (tMs: number) => {
      const current = settings.current;
      if (!current) return;
      place(Math.min(timelineDuration(current), Math.max(0, tMs)));
    },
    [place],
  );

  return { ref, element, clock, playing: element !== null && playing, failed: element !== null && failed, toggle, pause, seek };
}
