import type { z } from 'zod';

// A persisted setting: its zod schema and the value used until it is set.
export interface SettingDef<T = unknown> {
  schema: z.ZodType<T>;
  default: T;
}

export function defineSetting<T>(schema: z.ZodType<T>, defaultValue: T): SettingDef<T> {
  return { schema, default: defaultValue };
}

export type SettingsShape = Record<string, SettingDef>;
