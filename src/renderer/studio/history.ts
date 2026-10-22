// Undo/redo over immutable snapshots. A change that carries a gesture key (a
// slider drag, typing in a field) replaces the newest entry until the gesture
// ends, so one drag is one undo step. Pure, so it is easy to reason about.

export const HISTORY_LIMIT = 100;

export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
  /** The gesture the newest entry belongs to, while it lasts. */
  gesture: string | null;
}

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], gesture: null };
}

export function record<T>(history: History<T>, next: T, gesture?: string): History<T> {
  if (next === history.present) return history;
  if (gesture && history.gesture === gesture) return { ...history, present: next, future: [] };
  const past = [...history.past, history.present].slice(-(HISTORY_LIMIT - 1));
  return { past, present: next, future: [], gesture: gesture ?? null };
}

export function endGesture<T>(history: History<T>): History<T> {
  return history.gesture === null ? history : { ...history, gesture: null };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], gesture: null };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest, gesture: null };
}
