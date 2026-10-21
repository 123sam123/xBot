// The settings registry: every domain's settings, merged. Domains add keys in
// their own contract file (`<domain>Settings`), never here.
import { z } from 'zod';
import { aiSettings } from './ai';
import { appSettings } from './app';
import { backupSettings } from './backup';
import type { SettingDef } from './define';
import { draftsSettings } from './drafts';
import type { IpcResult } from './ipc';
import { mediaSettings } from './media';
import { projectsSettings } from './projects';
import { remindersSettings } from './reminders';
import { studioSettings } from './studio';
import { windowsSettings } from './windows';
import { xSettings } from './x';

export const settingsRegistry = {
  ...appSettings,
  ...windowsSettings,
  ...draftsSettings,
  ...mediaSettings,
  ...studioSettings,
  ...aiSettings,
  ...projectsSettings,
  ...remindersSettings,
  ...xSettings,
  ...backupSettings,
};

type Registry = typeof settingsRegistry;
export type SettingKey = keyof Registry & string;
export type SettingValue<K extends SettingKey> = Registry[K] extends SettingDef<infer T> ? T : never;
export type SettingsValues = { [K in SettingKey]: SettingValue<K> };

export const settingKeys = Object.keys(settingsRegistry) as SettingKey[];

function setSettingVariant(key: SettingKey) {
  return z.strictObject({ key: z.literal(key), value: settingsRegistry[key].schema });
}

// `{ key, value }` where value must match that key's own schema.
export const setSettingSchema = z.union(
  settingKeys.map(setSettingVariant) as unknown as [
    ReturnType<typeof setSettingVariant>,
    ...ReturnType<typeof setSettingVariant>[],
  ],
);

export interface SettingsEvents {
  'settings:changed': { key: SettingKey; value: unknown };
}

export const settingsForwardedEvents = ['settings:changed'] as const satisfies readonly (keyof SettingsEvents)[];

export interface SettingsApi {
  getAll(): Promise<IpcResult<SettingsValues>>;
  set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<IpcResult<null>>;
}
