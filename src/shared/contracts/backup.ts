// Owned by T10 (XBOT-1DDYA1). Payload schemas, settings, events and the bridge API for the
// `backup` domain live here; the aggregators already import this file.
import type { SettingsShape } from './define';

export const backupSettings = {} satisfies SettingsShape;

export interface BackupEvents {}

export const backupForwardedEvents = [] as const satisfies readonly (keyof BackupEvents)[];

export interface BackupApi {}
