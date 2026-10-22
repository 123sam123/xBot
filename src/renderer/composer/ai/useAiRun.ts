import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiAction, AiOption } from '../../../shared/contracts/ai';
import type { SelectionRef } from './aiApply';

// The composer's AI request: one at a time, cancellable, with its result kept
// until the next one, so closing the sheet or a failure never loses anything.
// The "What did you build today?" note lives here too, for the same reason.

export interface StartArgs {
  action: AiAction;
  text: string;
  note?: string;
  selection?: SelectionRef | null;
}

export interface AiRunState {
  requestId: string | null;
  action: AiAction | null;
  running: boolean;
  /** 1 for the first answer, 2–3 while the model is asked to repair it. */
  attempt: number;
  options: AiOption[];
  trimmed: boolean;
  error: { code: string; message: string } | null;
  /** The selection a `selection` request rewrites. */
  selection: SelectionRef | null;
  /** Bumped when a request finishes with suggestions. */
  finished: number;
}

const IDLE: AiRunState = { requestId: null, action: null, running: false, attempt: 0, options: [], trimmed: false, error: null, selection: null, finished: 0 };

export interface AiRun extends AiRunState {
  note: string;
  setNote(note: string): void;
  start(args: StartArgs): Promise<void>;
  retry(): void;
  cancel(): void;
  clearError(): void;
}

export function useAiRun(): AiRun {
  const [state, setState] = useState<AiRunState>(IDLE);
  const [note, setNote] = useState('');
  const current = useRef<string | null>(null);
  const last = useRef<StartArgs | null>(null);

  useEffect(() => {
    const off = window.xbot.events.on('ai:progress', (progress) => {
      if (progress.requestId !== current.current) return;
      // A new attempt (a repair) starts from nothing: its partial options replace the old ones.
      setState((prev) => (prev.requestId === progress.requestId ? { ...prev, attempt: progress.attempt, options: progress.options } : prev));
    });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setState((prev) => (prev.error ? { ...prev, error: null } : prev));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const start = useCallback(async (args: StartArgs) => {
    const requestId = crypto.randomUUID();
    current.current = requestId;
    last.current = args;
    const selection = args.action === 'selection' ? (args.selection ?? null) : null;
    setState((prev) => ({ ...IDLE, finished: prev.finished, requestId, action: args.action, running: true, attempt: 1, selection }));
    const note = args.note?.trim() ? args.note : undefined;
    const result = await window.xbot.ai.generate({
      requestId,
      action: args.action,
      text: args.text,
      note,
      selection: selection ? { start: selection.start, end: selection.end } : undefined,
    });
    if (current.current !== requestId) return;
    current.current = null;
    if (!result.ok) {
      setState((prev) => ({ ...prev, running: false, options: [], error: result.error }));
    } else if (result.data.status === 'cancelled') {
      setState((prev) => ({ ...prev, running: false, options: [] }));
    } else {
      const { options, trimmed } = result.data;
      setState((prev) => ({ ...prev, running: false, options, trimmed, finished: prev.finished + 1 }));
    }
  }, []);

  const retry = useCallback(() => {
    if (last.current && !current.current) void start(last.current);
  }, [start]);

  const cancel = useCallback(() => {
    if (current.current) void window.xbot.ai.cancel(current.current);
  }, []);

  const clearError = useCallback(() => setState((prev) => (prev.error ? { ...prev, error: null } : prev)), []);

  return { ...state, note, setNote, start, retry, cancel, clearError };
}
