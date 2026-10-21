// Owned by T8 (XBOT-8V5WV5). The scaffold only defines the two settings the
// tray menu already uses; T8 adds the scheduler and the rest.
import { z } from 'zod';
import { defineSetting, type SettingsShape } from './define';

export const remindersSettings = {
  'reminders.paused': defineSetting(z.boolean(), false),
  'reminders.intervalMinutes': defineSetting(z.number().int().min(5).max(240), 30),
} satisfies SettingsShape;

export interface RemindersEvents {}

export const remindersForwardedEvents = [] as const satisfies readonly (keyof RemindersEvents)[];

export interface RemindersApi {}
