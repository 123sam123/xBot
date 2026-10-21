// Owned by T3 (XBOT-6F4GAC). Payload schemas, settings, events and the bridge API for the
// `media` domain live here; the aggregators already import this file.
import type { SettingsShape } from './define';

export const mediaSettings = {} satisfies SettingsShape;

export interface MediaEvents {}

export const mediaForwardedEvents = [] as const satisfies readonly (keyof MediaEvents)[];

export interface MediaApi {}
