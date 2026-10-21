import type { IpcResult } from './ipc';
import type { SettingsShape } from './define';

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  isPackaged: boolean;
  isPreview: boolean;
  /** Whether the OS emoji picker exists (`app.isEmojiPanelSupported()`). */
  emojiPanel: boolean;
}

/**
 * One integration's state, e.g. "Local AI ready" or "X disconnected". Each
 * domain registers a provider in main (src/main/status.ts); Settings → Status
 * shows them as chips.
 */
export interface IntegrationStatus {
  id: string;
  label: string;
  tone: 'ok' | 'neutral' | 'warning' | 'busy';
  /** A second, quieter line, e.g. what to do about it. */
  detail?: string;
}

export const appSettings = {} satisfies SettingsShape;

export interface AppEvents {
  /** Every provider's current status, in order, whenever one changes. */
  'status:changed': { statuses: IntegrationStatus[] };
}

export const appForwardedEvents = ['status:changed'] as const satisfies readonly (keyof AppEvents)[];

export interface AppApi {
  getInfo(): Promise<IpcResult<AppInfo>>;
  getStatus(): Promise<IpcResult<IntegrationStatus[]>>;
}
