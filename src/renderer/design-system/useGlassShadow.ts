import { useEffect } from 'react';
import { hasNativeGlass } from './useAppearance';

/** At most one shadow refresh per this many ms while the page keeps changing. */
const THROTTLE_MS = 200;

/**
 * Under the native glass the window's shadow is computed from its pixels and
 * shows through the clear glass, so a stale one leaves ghosts of content that
 * has gone: a closed popover or sheet, deleted text. Whenever the page changes
 * (DOM mutations, input, scrolling, finished animations, loaded images) this
 * asks main to recompute it, once the change has painted. A no-op without the
 * native glass.
 */
export function useGlassShadow(): void {
  useEffect(() => {
    if (!hasNativeGlass()) return;
    let timer: number | undefined;
    const refresh = () => {
      timer = undefined;
      // Two frames: the change has been painted, not just laid out.
      requestAnimationFrame(() => requestAnimationFrame(() => void window.xbot.windows.refreshGlassShadow()));
    };
    const changed = () => {
      timer ??= window.setTimeout(refresh, THROTTLE_MS);
    };
    const observer = new MutationObserver(changed);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const events = ['input', 'scroll', 'transitionend', 'animationend', 'load', 'pointerup'];
    for (const type of events) document.addEventListener(type, changed, true);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      for (const type of events) document.removeEventListener(type, changed, true);
    };
  }, []);
}
