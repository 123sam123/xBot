import { useCallback, useEffect, useRef, useState } from 'react';
import type { Draft } from '../../shared/contracts/drafts';

// The composer's persisted draft. Text is saved 400 ms after the last
// keystroke, and at once when the window blurs or hides, when the page goes
// away, and when main asks before quitting. The latest text lives in a ref, so
// a flush always sends what was typed last, never a value an effect captured.

export type SaveState = 'loading' | 'saved' | 'pending' | 'error';

const SAVE_DELAY_MS = 400;

export interface DraftModel {
  /** Null until the current draft has loaded. */
  draft: Draft | null;
  text: string;
  saveState: SaveState;
  setText(text: string): void;
  /** Saves pending text now; resolves false if the save failed. */
  flush(): Promise<boolean>;
  /** Takes a draft returned by a call: its attachments, and its text when it is a different draft. */
  apply(draft: Draft): void;
  /** Saves pending text, then reloads the current draft (after a change made elsewhere). */
  refresh(): Promise<void>;
}

export function useDraft(enabled: boolean): DraftModel {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setTextState] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('loading');
  const latest = useRef<{ id: string | null; text: string; dirty: boolean }>({ id: null, text: '', dirty: false });
  const timer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  /** Bumped on every applied draft, so a slow reload never overwrites a newer result. */
  const version = useRef(0);

  const flush = useCallback((): Promise<boolean> => {
    window.clearTimeout(timer.current);
    const run = async (): Promise<boolean> => {
      const { id, text: value, dirty } = latest.current;
      if (!id || !dirty) return true;
      latest.current.dirty = false;
      const result = await window.xbot.drafts.update(id, value);
      if (!result.ok) {
        // Keep the text and try again with the next change (or flush).
        if (latest.current.id === id) latest.current.dirty = true;
        setSaveState('error');
        return false;
      }
      if (!latest.current.dirty) setSaveState('saved');
      return true;
    };
    // Saves run one after another, so they land in typing order.
    const next = queue.current.then(run, run);
    queue.current = next;
    return next;
  }, []);

  const setText = useCallback(
    (value: string) => {
      latest.current.text = value;
      latest.current.dirty = true;
      setTextState(value);
      setSaveState('pending');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const apply = useCallback((next: Draft) => {
    version.current += 1;
    if (next.id !== latest.current.id) {
      latest.current = { id: next.id, text: next.text, dirty: false };
      setTextState(next.text);
      setSaveState('saved');
    }
    setDraft(next);
  }, []);

  const refresh = useCallback(async () => {
    await flush();
    const asked = version.current;
    const result = await window.xbot.drafts.getCurrent();
    if (!result.ok) {
      console.error('drafts: could not load the current draft', result.error);
      return;
    }
    if (version.current === asked) apply(result.data);
  }, [apply, flush]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const save = () => void flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('blur', save);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    const offFlush = window.xbot.events.on('drafts:flush-requested', () => {
      void flush().then(() => window.xbot.drafts.flushed());
    });
    const offChanged = window.xbot.events.on('draft:changed', () => void refresh());
    return () => {
      window.removeEventListener('blur', save);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVisibility);
      offFlush();
      offChanged();
      window.clearTimeout(timer.current);
    };
  }, [enabled, flush, refresh]);

  return { draft, text, saveState, setText, flush, apply, refresh };
}
