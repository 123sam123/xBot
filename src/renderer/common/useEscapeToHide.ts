import { useEffect } from 'react';

/**
 * Escape hides this window. Popovers and sheets that handle Escape themselves
 * call `event.preventDefault()` first, and this listener then leaves it alone.
 * An Escape that cancels IME composition (e.g. CJK input) is the input
 * method's, not the window's.
 */
export function useEscapeToHide(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      void window.xbot.windows.hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
