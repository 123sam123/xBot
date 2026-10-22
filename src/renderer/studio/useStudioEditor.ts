import { useCallback, useEffect, useRef, useState } from 'react';
import type { Composition } from '../../shared/composition/model';
import type { IpcResult } from '../../shared/contracts/ipc';
import type { MediaItem } from '../../shared/contracts/media';
import type { StudioDocument, StudioView } from '../../shared/contracts/studio';
import { PREVIEW_COMPOSITION, PREVIEW_MEDIA } from '../preview/fixtures';
import { endGesture, record, redo, startHistory, undo, type History } from './history';

// The Studio's open document and its edits. Every edit is an undoable
// snapshot; saves go through one serial queue, 500 ms after the last change
// (and at once before switching documents, on hide and before quitting), and
// each names the revision it started from. "Add to post" runs in the same
// queue, after the last save. Preview mode edits the sample locally.

const SAVE_DELAY_MS = 500;

export type EditorStatus = 'loading' | 'empty' | 'document' | 'view';

export interface StudioEditor {
  status: EditorStatus;
  /** The open document as loaded; its live composition is `composition`. */
  document: StudioDocument | null;
  view: StudioView | null;
  history: History<Composition> | null;
  composition: Composition | null;
  revision: number;
  /** Media the compositions refer to, by id. */
  media: ReadonlyMap<string, MediaItem>;
  change(next: Composition, gesture?: string): void;
  /** Changes the newest composition (for edits that finish after an await, such as a picker). */
  update(make: (current: Composition) => Composition, gesture?: string): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  /** Saves pending edits now; false if the save failed. */
  flush(): Promise<boolean>;
  /** Saves pending edits, then runs `task` in the save queue with the revision to build on. */
  afterSaves<T extends { revision: number }>(task: (documentId: string, revision: number) => Promise<IpcResult<T>>): Promise<IpcResult<T>>;
  open(document: StudioDocument): void;
  /** Opens what a pick or a drop became: a document, or a read-only video (FFmpeg missing). */
  openSession(opened: { document: StudioDocument } | { view: StudioView }): void;
  addMedia(item: MediaItem): void;
  error: string | null;
  setError(message: string | null): void;
  notice: string | null;
  setNotice(message: string | null): void;
}

const PREVIEW_DOCUMENT: StudioDocument = {
  id: 'preview',
  revision: 0,
  composition: PREVIEW_COMPOSITION,
  source: PREVIEW_MEDIA,
  sourceMissing: false,
  background: null,
  gif: false,
  video: null,
  exportJob: null,
  updatedAt: '',
};

/** Preview mode starts on the sample; normal mode loads main's session. */
export function useStudioEditor(preview: boolean): StudioEditor {
  const [status, setStatus] = useState<EditorStatus>(preview ? 'document' : 'loading');
  const [document, setDocument] = useState<StudioDocument | null>(preview ? PREVIEW_DOCUMENT : null);
  const [view, setView] = useState<StudioView | null>(null);
  const [history, setHistory] = useState<History<Composition> | null>(() => (preview ? startHistory(PREVIEW_COMPOSITION) : null));
  const [revision, setRevision] = useState(0);
  const [media, setMedia] = useState<ReadonlyMap<string, MediaItem>>(() => new Map(preview ? [[PREVIEW_MEDIA.id, PREVIEW_MEDIA]] : []));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const historyRef = useRef<History<Composition> | null>(history);
  const latest = useRef<{ documentId: string | null; dirty: boolean }>({ documentId: document?.id ?? null, dirty: false });
  const revisions = useRef(new Map<string, number>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<number | undefined>(undefined);

  const addMedia = useCallback((item: MediaItem) => {
    setMedia((current) => (current.get(item.id) === item ? current : new Map(current).set(item.id, item)));
  }, []);

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task);
    queue.current = run.catch(() => {});
    return run;
  }, []);

  const load = useCallback(
    (next: StudioDocument) => {
      const fresh = startHistory(next.composition);
      historyRef.current = fresh;
      latest.current = { documentId: next.id, dirty: false };
      revisions.current.set(next.id, next.revision);
      setHistory(fresh);
      setRevision(next.revision);
      setDocument(next);
      setView(null);
      setStatus('document');
      addMedia(next.source);
      if (next.background) addMedia(next.background);
    },
    [addMedia],
  );

  const reload = useCallback(async () => {
    const result = await window.xbot.studio.current();
    if (result.ok && result.data && 'document' in result.data) load(result.data.document);
  }, [load]);

  const flush = useCallback((): Promise<boolean> => {
    window.clearTimeout(timer.current);
    const { documentId, dirty } = latest.current;
    const composition = historyRef.current?.present;
    if (preview || !documentId || !composition || !dirty) return enqueue(async () => true);
    latest.current.dirty = false;
    // The snapshot is taken now, so switching documents cannot redirect it.
    return enqueue(async () => {
      const result = await window.xbot.studio.save(documentId, revisions.current.get(documentId) ?? 0, composition);
      if (result.ok) {
        revisions.current.set(documentId, result.data.revision);
        if (latest.current.documentId === documentId) setRevision(result.data.revision);
        return true;
      }
      if (latest.current.documentId === documentId) {
        if (result.error.code === 'stale_revision') {
          await reload();
          setNotice(result.error.message);
        } else {
          latest.current.dirty = true; // retried with the next change
          setError(result.error.message);
        }
      }
      return false;
    });
  }, [enqueue, preview, reload]);

  const commit = useCallback(
    (next: History<Composition>) => {
      if (next === historyRef.current) return;
      historyRef.current = next;
      setHistory(next);
      latest.current.dirty = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const change = useCallback(
    (next: Composition, gesture?: string) => {
      if (historyRef.current) commit(record(historyRef.current, next, gesture));
    },
    [commit],
  );

  const update = useCallback(
    (make: (current: Composition) => Composition, gesture?: string) => {
      if (historyRef.current) commit(record(historyRef.current, make(historyRef.current.present), gesture));
    },
    [commit],
  );

  const afterSaves = useCallback<StudioEditor['afterSaves']>(
    (task) => {
      void flush();
      return enqueue(async () => {
        const documentId = latest.current.documentId!;
        const result = await task(documentId, revisions.current.get(documentId) ?? 0);
        if (result.ok) {
          revisions.current.set(documentId, result.data.revision);
          if (latest.current.documentId === documentId) setRevision(result.data.revision);
        } else if (result.error.code === 'stale_revision') {
          await reload();
        }
        return result;
      });
    },
    [enqueue, flush, reload],
  );

  const open = useCallback(
    (next: StudioDocument) => {
      void flush();
      load(next);
      setError(null);
    },
    [flush, load],
  );

  const showView = useCallback(
    (next: StudioView) => {
      void flush();
      latest.current = { documentId: null, dirty: false };
      historyRef.current = null;
      setHistory(null);
      setDocument(null);
      setView(next);
      setStatus('view');
    },
    [flush],
  );

  const openSession = useCallback(
    (opened: { document: StudioDocument } | { view: StudioView }) => {
      setError(null);
      if ('document' in opened) open(opened.document);
      else showView(opened.view);
    },
    [open, showView],
  );

  // The document to show: the sample in preview, else main's session, kept current by `studio:opened`.
  useEffect(() => {
    if (preview) return;
    let alive = true;
    void window.xbot.studio.current().then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setError(result.error.message);
        setStatus('empty');
      } else if (!result.data) setStatus('empty');
      else if ('document' in result.data) load(result.data.document);
      else {
        setView(result.data.view);
        setStatus('view');
      }
    });
    const offOpened = window.xbot.events.on('studio:opened', (opened) => {
      if ('error' in opened) {
        setError(opened.error);
        return;
      }
      void flush();
      setError(null);
      if ('document' in opened) load(opened.document);
      else showView(opened.view);
    });
    const offFlush = window.xbot.events.on('studio:flush-requested', () => {
      void flush().then(() => window.xbot.studio.flushed());
    });
    const save = () => void flush();
    const onVisibility = () => {
      if (window.document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    window.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      offOpened();
      offFlush();
      window.removeEventListener('pagehide', save);
      window.document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(timer.current);
    };
  }, [preview, load, flush, showView]);

  return {
    status,
    document,
    view,
    history,
    composition: history?.present ?? null,
    revision,
    media,
    change,
    update,
    endGesture: () => historyRef.current && commitGestureEnd(historyRef, setHistory),
    undo: () => historyRef.current && commit(undo(historyRef.current)),
    redo: () => historyRef.current && commit(redo(historyRef.current)),
    flush,
    afterSaves,
    open,
    openSession,
    addMedia,
    error,
    setError,
    notice,
    setNotice,
  };
}

/** Ending a gesture changes no composition, so nothing is saved. */
function commitGestureEnd(
  ref: { current: History<Composition> | null },
  setHistory: (history: History<Composition>) => void,
): void {
  if (!ref.current) return;
  const next = endGesture(ref.current);
  ref.current = next;
  setHistory(next);
}
