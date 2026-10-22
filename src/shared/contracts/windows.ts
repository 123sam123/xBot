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
  /**
   * Settings → Appearance → Glass clarity: how far the native glass's frost
   * fades, from 0 (as macOS draws it) to 1 (invisible). macOS with the native
   * glass addon only (src/main/windows/glass.ts).
   */
  'ui.glassClarity': defineSetting(z.number().min(0).max(1), 0.8),
  /** Onboarding steps the user has moved past or skipped (src/renderer/onboarding/). */
  'ui.onboardingSeen': defineSetting(z.array(z.string().max(64)).max(200), []),
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
  /** Opens the OS emoji picker for the focused text field. */
  showEmojiPanel(): Promise<IpcResult<null>>;
  /**
   * Recomputes the sender window's shadow, which shows through the native
   * glass (see `useGlassShadow`). A no-op without the native glass.
   */
  refreshGlassShadow(): Promise<IpcResult<null>>;
}
