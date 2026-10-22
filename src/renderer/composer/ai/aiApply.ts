// Where an AI suggestion goes in the post text. Pure: the composer applies
// the plan through the editor (so it is undoable) and keeps one undo entry.

export interface SelectionRef {
  start: number;
  end: number;
  /** The text that was selected when the user asked. */
  text: string;
}

export type ApplyPlan = { start: number; end: number; insert: string } | { error: string };

export const TEXT_CHANGED = 'Your text changed since you asked. Copy the suggestion instead.';

/**
 * `whole` replaces the entire text (the user chose this suggestion over it).
 * `selection` replaces the originally selected text: where it was, or its
 * only occurrence if it moved; otherwise it refuses rather than guess.
 */
export function planApply(current: string, insert: string, mode: 'whole' | 'selection', selection?: SelectionRef | null): ApplyPlan {
  if (mode === 'whole' || !selection) return { start: 0, end: current.length, insert };
  if (current.slice(selection.start, selection.end) === selection.text) return { start: selection.start, end: selection.end, insert };
  const first = current.indexOf(selection.text);
  if (selection.text !== '' && first >= 0 && current.indexOf(selection.text, first + 1) < 0) {
    return { start: first, end: first + selection.text.length, insert };
  }
  return { error: TEXT_CHANGED };
}

/** The last AI change to a draft: undoable while the text is still exactly `after`. */
export interface UndoEntry {
  draftId: string | null;
  before: string;
  after: string;
}

export function canUndo(entry: UndoEntry | null, draftId: string | null, current: string): entry is UndoEntry {
  return entry !== null && entry.draftId === draftId && entry.after === current;
}

/**
 * Replaces `start..end` of the textarea with `insert` through the editing
 * pipeline, so the change fires a normal input event (autosave) and Cmd+Z
 * reverts it. Returns false when the browser refused; the caller then sets
 * the text directly.
 */
export function insertThroughEditor(el: HTMLTextAreaElement, start: number, end: number, insert: string): boolean {
  el.focus({ preventScroll: true });
  el.setSelectionRange(start, end);
  // execCommand is deprecated but is still the only way to keep the native undo stack.
  return insert === '' ? document.execCommand('delete') : document.execCommand('insertText', false, insert);
}
