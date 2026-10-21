import { z } from 'zod';
import { defineSetting, type SettingsShape } from './define';
import type { IpcResult } from './ipc';

export const resizeComposerSchema = z.strictObject({
  height: z.number().int().min(80).max(2000),
});
export type ResizeComposerPayload = z.infer<typeof resizeComposerSchema>;

export const windowsSettings = {
  'ui.reduceTransparency': defineSetting(z.boolean(), false),
  /** Stronger scrim and borders behind text, on top of the OS "Increase contrast" preference. */
  'ui.increaseContrast': defineSetting(z.boolean(), false),
} satisfies SettingsShape;

/**
 * What the renderer draws over, passed to each page as `?material=`:
 * `vibrancy` is the native macOS material (the page adds only translucent
 * layers); `css` is the CSS-only glass over its own neutral base.
 */
export type RendererMaterial = 'vibrancy' | 'css';

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
