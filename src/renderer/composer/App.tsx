import { useEffect, useRef, useState } from 'react';
import type { AppInfo } from '../../shared/contracts/app';
import { useEscapeToHide } from '../common/useEscapeToHide';

// Placeholder composer. T2 (XBOT-6AU4BQ) builds the real Write Post surface
// and T3 (XBOT-6F4GAC) makes the draft persistent.

/** Keeps the window exactly as tall as its content, so no empty region shows below it. */
function useFitWindowToContent(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const send = () => void window.xbot.windows.resizeComposer(Math.ceil(el.getBoundingClientRect().height));
    const observer = new ResizeObserver(send);
    observer.observe(el);
    // A ResizeObserver may not fire while the window is hidden; re-send on show.
    document.addEventListener('visibilitychange', send);
    send();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', send);
    };
  }, [ref]);
}

export function App() {
  const panel = useRef<HTMLElement>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settingsRequested, setSettingsRequested] = useState(false);

  useEscapeToHide();
  useFitWindowToContent(panel);

  useEffect(() => {
    void window.xbot.app.getInfo().then((result) => result.ok && setInfo(result.data));
    return window.xbot.events.on('ui:open-settings', () => setSettingsRequested(true));
  }, []);

  return (
    <main ref={panel} className="composer">
      <header className="composer-header">
        <span className="composer-logo" aria-hidden="true" />
        <span className="composer-name">xBot</span>
        <span className="composer-account">No X account connected</span>
      </header>
      <h1>Write Post</h1>
      <textarea className="composer-editor" placeholder="What did you build today?" rows={4} />
      {settingsRequested && <p className="composer-note">Settings open here once T2 adds the sheet.</p>}
      <footer className="composer-footer">
        <button type="button" onClick={() => void window.xbot.windows.openStudio()}>
          Open Media Studio
        </button>
        <span className="composer-meta">
          Placeholder · v{info?.version ?? '…'}
          {info?.isPreview ? ' · preview' : ''}
        </span>
      </footer>
    </main>
  );
}
