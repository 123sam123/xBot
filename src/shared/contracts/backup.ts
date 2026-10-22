// Owned by T10 (XBOT-1DDYA1). "Settings → Data → Back up data…": a timestamped
// folder with a consistent copy of the database and the media it names. The
// renderer never sends a path: main asks for the folder and remembers the
// last backup for "Show in Finder".
import type { SettingsShape } from './define';
import type { IpcResult } from './ipc';

/** What one backup wrote. */
export interface BackupResult {
  /** The backup folder's name, e.g. "xBot Backup 2026-10-22 14.05.09". */
  folderName: string;
  /** Tables copied, and their rows in total. */
  tables: number;
  rows: number;
  /** Media files copied (thumbnails included), and their bytes. */
  mediaFiles: number;
  bytes: number;
  /** Media files the database names that were not on disk. */
  missing: number;
}

export const backupSettings = {} satisfies SettingsShape;

export interface BackupEvents {}

export const backupForwardedEvents = [] as const satisfies readonly (keyof BackupEvents)[];

export interface BackupApi {
  /** Opens a folder picker, then backs up into it. Null when the picker was cancelled. */
  create(): Promise<IpcResult<BackupResult | null>>;
  /** Shows the last backup in Finder. */
  reveal(): Promise<IpcResult<null>>;
}
