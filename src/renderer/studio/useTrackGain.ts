import { useEffect } from 'react';

// A volume for an audio element that can go past 100 %: the element is routed
// through a Web Audio gain node (an element can be routed only once, so the
// node is kept per element).

let context: AudioContext | null = null;
const gains = new WeakMap<HTMLMediaElement, GainNode>();

function gainFor(element: HTMLMediaElement): GainNode {
  let gain = gains.get(element);
  if (!gain) {
    context ??= new AudioContext();
    gain = context.createGain();
    context.createMediaElementSource(element).connect(gain).connect(context.destination);
    gains.set(element, gain);
  }
  return gain;
}

export function useTrackGain(element: HTMLMediaElement | null, volume: number): void {
  useEffect(() => {
    if (!element) return;
    const gain = gainFor(element);
    gain.gain.value = volume;
    if (context?.state === 'suspended') void context.resume();
  }, [element, volume]);
}
