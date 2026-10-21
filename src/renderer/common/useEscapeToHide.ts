import { useEffect } from 'react';

/**
 * Escape hides this window. Popovers and sheets that handle Escape themselves
 * call `event.preventDefault()` first, and this listener then leaves it alone.
 */
export function useEscapeToHide(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      void window.xbot.windows.hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
