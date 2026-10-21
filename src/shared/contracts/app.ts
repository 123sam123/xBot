import type { IpcResult } from './ipc';
import type { SettingsShape } from './define';

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  isPackaged: boolean;
  isPreview: boolean;
}

export const appSettings = {} satisfies SettingsShape;

export interface AppEvents {}

export const appForwardedEvents = [] as const satisfies readonly (keyof AppEvents)[];

export interface AppApi {
  getInfo(): Promise<IpcResult<AppInfo>>;
}
