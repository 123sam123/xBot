// Owned by T4/T5 (XBOT-1N58PP, XBOT-G66JJK). Payload schemas, settings, events and the bridge API for the
// `studio` domain live here; the aggregators already import this file.
import type { SettingsShape } from './define';

export const studioSettings = {} satisfies SettingsShape;

export interface StudioEvents {
  /** Export job progress, 0–1. */
  'export:progress': { jobId: string; progress: number };
}

export const studioForwardedEvents = [] as const satisfies readonly (keyof StudioEvents)[];

export interface StudioApi {}
