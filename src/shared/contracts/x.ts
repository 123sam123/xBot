// Owned by T9 (XBOT-OE2XV9). Payload schemas, settings, events and the bridge API for the
// `x` domain live here; the aggregators already import this file.
import type { SettingsShape } from './define';

export const xSettings = {} satisfies SettingsShape;

export interface XEvents {
  'post:published': { postId: string; url: string };
}

export const xForwardedEvents = [] as const satisfies readonly (keyof XEvents)[];

export interface XApi {}
