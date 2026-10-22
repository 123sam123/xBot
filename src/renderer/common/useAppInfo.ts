import { useEffect, useState } from 'react';
import type { AppInfo } from '../../shared/contracts/app';

/** App info, fetched once. `ready` turns true when the call settles, even if it failed. */
export function useAppInfo(): { info: AppInfo | null; ready: boolean } {
  const [state, setState] = useState<{ info: AppInfo | null; ready: boolean }>({ info: null, ready: false });
  useEffect(() => {
    void window.xbot.app.getInfo().then((result) => setState({ info: result.ok ? result.data : null, ready: true }));
  }, []);
  return state;
}

/** Marks the page as settled (`<html data-ready>`), so captures and tests wait for real content. */
export function useReadyMarker(ready: boolean): void {
  useEffect(() => {
    if (ready) document.documentElement.dataset.ready = 'true';
  }, [ready]);
}
