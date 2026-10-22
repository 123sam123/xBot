// Preview mode's renderer-only labels (`--preview` / XBOT_PREVIEW=1). The
// sample drafts, media and idea are real rows main seeds from
// src/shared/previewSample.ts; only these two never reach the database,
// because preview mode has no X account and no reminder timer. T2 created
// this; T10 (XBOT-1DDYA1) moved the rest out.

/** The header's sample handle, always shown with a "Preview" badge. */
export const PREVIEW_HANDLE = '@samuelbuilds';

export const PREVIEW_REMINDER_LABEL = 'Next reminder in 30 min';
