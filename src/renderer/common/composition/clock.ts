import { useSyncExternalStore } from 'react';

// The playhead, in output ms, outside React state: playback moves it every
// frame, and only what shows it (the canvas, the time readout, the timeline's
// playhead) subscribes, so the rest of the Studio doesn't re-render at 60 fps.

export interface Clock {
  get(): number;
  set(ms: number): void;
  subscribe(listener: () => void): () => void;
}

export function createClock(initial = 0): Clock {
  let now = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => now,
    set(ms) {
      if (ms === now) return;
      now = ms;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useClock(clock: Clock): number {
  return useSyncExternalStore(clock.subscribe, clock.get);
}
