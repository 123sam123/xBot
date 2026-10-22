import { useEffect, useRef } from 'react';

// Escape closes the top-most layer (popover, menu or sheet) and nothing else.
// One capture-phase listener runs before the window's own Escape-to-hide
// (`useEscapeToHide`, a bubble-phase listener) and marks the event handled.

type Layer = { onEscape: () => void };

const layers: Layer[] = [];

function onKeyDown(event: KeyboardEvent): void {
  // An Escape that cancels IME composition belongs to the input method.
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  const top = layers.at(-1);
  if (!top) return;
  event.preventDefault();
  top.onEscape();
}

function pushLayer(layer: Layer): () => void {
  if (layers.length === 0) window.addEventListener('keydown', onKeyDown, { capture: true });
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
    if (layers.length === 0) window.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}

/** While `active`, Escape calls `onEscape` instead of reaching anything below this layer. */
export function useEscapeLayer(active: boolean, onEscape: () => void): void {
  const handler = useRef(onEscape);
  useEffect(() => {
    handler.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    return pushLayer({ onEscape: () => handler.current() });
  }, [active]);
}
