import type { ComponentType } from 'react';

// The settings sheet's sections. Each is a file in ./sections/ whose default
// export is a SettingsSection; this module collects them at build time, so a
// ticket adds its section by adding a file and edits nothing shared.

export interface SettingsSection {
  /** Unique, e.g. 'ai' or 'reminders'. */
  id: string;
  /** Sections sort by `order`, then `id`. Built in: Status 0, Appearance 100. */
  order: number;
  title: string;
  /** Reads its own state (e.g. `useSettings()`). A section that renders nothing is hidden. */
  Component: ComponentType;
}

const modules = import.meta.glob<{ default: SettingsSection }>('./sections/*.tsx', { eager: true });

export const settingsSections: readonly SettingsSection[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
