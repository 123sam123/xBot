import { z } from 'zod';
import { defineSetting, type SettingsShape } from './define';
import type { IpcResult } from './ipc';

export const resizeComposerSchema = z.strictObject({
  height: z.number().int().min(80).max(2000),
});
export type ResizeComposerPayload = z.infer<typeof resizeComposerSchema>;

export const windowsSettings = {
  'ui.reduceTransparency': defineSetting(z.boolean(), false),
} satisfies SettingsShape;

export interface WindowsEvents {
  /** Tray "Settings…" was chosen; the composer opens its settings sheet. */
  'ui:open-settings': Record<string, never>;
}

export const windowsForwardedEvents = ['ui:open-settings'] as const satisfies readonly (keyof WindowsEvents)[];

export interface WindowsApi {
  hide(): Promise<IpcResult<null>>;
  hold(): Promise<IpcResult<null>>;
  release(): Promise<IpcResult<null>>;
  resizeComposer(height: number): Promise<IpcResult<null>>;
  showComposer(): Promise<IpcResult<null>>;
  openStudio(): Promise<IpcResult<null>>;
}
