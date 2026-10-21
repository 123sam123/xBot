// Owned by T3 (XBOT-6F4GAC). Payload schemas, settings, events and the bridge API for the
// `drafts` domain live here; the aggregators already import this file.
import type { SettingsShape } from './define';

export const draftsSettings = {} satisfies SettingsShape;

export interface DraftsEvents {
  'draft:changed': { draftId: string };
}

export const draftsForwardedEvents = [] as const satisfies readonly (keyof DraftsEvents)[];

export interface DraftsApi {}
