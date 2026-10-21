// Owned by T6 (XBOT-4BCGOR). Payload schemas, settings, events and the bridge API for the
// `ai` domain live here; the aggregators already import this file.
import type { SettingsShape } from './define';

export const aiSettings = {} satisfies SettingsShape;

export interface AiEvents {}

export const aiForwardedEvents = [] as const satisfies readonly (keyof AiEvents)[];

export interface AiApi {}
