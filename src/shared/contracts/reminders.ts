// Owned by T8 (XBOT-8V5WV5). Reminders (SPEC §13), plus launch at login and
// the global shortcut (§4). The schedule's rules are in
// src/shared/reminders/schedule.ts and ARCHITECTURE.md → "Reminders".
import { z } from 'zod';
import type { DueReason, SnoozeKind } from '../reminders/schedule';
import { defineSetting, type SettingsShape } from './define';
import type { IpcResult } from './ipc';
import type { Idea } from './projects';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const remindersSettings = {
  'reminders.paused': defineSetting(z.boolean(), false),
  'reminders.intervalMinutes': defineSetting(z.number().int().min(5).max(240), 30),
  /** Working hours in the detected OS time zone. An end at or before the start runs into the next day. */
  'reminders.workStart': defineSetting(clock, '09:00'),
  'reminders.workEnd': defineSetting(clock, '18:00'),
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  'reminders.days': defineSetting(
    z
      .array(z.number().int().min(1).max(7))
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'Each day once'),
    [1, 2, 3, 4, 5],
  ),
  'reminders.dailyCap': defineSetting(z.number().int().min(1).max(48), 8),
  /** "Open dropdown on reminder": the composer opens without focus when that is safe. */
  'reminders.autoOpen': defineSetting(z.boolean(), true),
  /** Always a notification; never the dropdown. */
  'reminders.notificationOnly': defineSetting(z.boolean(), false),
  /** The global shortcut that toggles the composer, as an Electron accelerator; '' is off. */
  'reminders.shortcut': defineSetting(z.string().max(64), 'Alt+CommandOrControl+X'),
} satisfies SettingsShape;

export type ReminderDelivery = 'auto-open' | 'notification' | 'already-open';

/** One fired reminder, until it is dismissed, snoozed, skipped or replaced. */
export interface ReminderCycle {
  id: string;
  firedAt: string;
  delivery: ReminderDelivery;
  /** T7's top idea when it fired (kept current while the cycle lasts). */
  idea: Idea | null;
}

export interface ReminderStatus {
  /** False in preview mode: no scheduler runs. */
  enabled: boolean;
  /** When the next reminder is due (ISO), or null when none is scheduled. */
  nextAt: string | null;
  /** Which rule set `nextAt`. */
  reason: DueReason;
  snoozedUntil: string | null;
  snoozeKind: SnoozeKind | null;
  /** The quiet period after a published post, while it lasts. */
  cooldownUntil: string | null;
  firedToday: number;
  dailyCap: number;
  capReached: boolean;
  /** The detected IANA time zone the working hours are in. */
  timeZone: string;
  cycle: ReminderCycle | null;
  /** The last notification attempt: shown, or why not. */
  notifications: 'ok' | 'unsupported' | 'failed';
}

export interface StartupStatus {
  launchAtLogin: {
    /** False when unpackaged, outside /Applications, or not on macOS / Windows. */
    available: boolean;
    enabled: boolean;
    /** macOS wants the user to approve the login item in System Settings. */
    needsApproval: boolean;
    /** Why it is unavailable, or what went wrong. */
    note: string | null;
  };
  shortcut: {
    /** The saved accelerator ('' is off). */
    accelerator: string;
    registered: boolean;
    error: string | null;
  };
}

export const snoozeSchema = z.union([
  z.strictObject({ minutes: z.number().int().min(1).max(1440) }),
  z.strictObject({ until: z.literal('tomorrow') }),
]);
export type SnoozePayload = z.infer<typeof snoozeSchema>;

export const launchAtLoginSchema = z.strictObject({ enabled: z.boolean() });
export const shortcutSchema = z.strictObject({ accelerator: z.string().max(64) });
export const recordShortcutSchema = z.strictObject({ active: z.boolean() });

export interface RemindersEvents {
  /** The schedule, a snooze, a fire or the notification state changed. */
  'reminders:changed': ReminderStatus;
}

export const remindersForwardedEvents = ['reminders:changed'] as const satisfies readonly (keyof RemindersEvents)[];

export interface RemindersApi {
  getStatus(): Promise<IpcResult<ReminderStatus>>;
  snooze(payload: SnoozePayload): Promise<IpcResult<ReminderStatus>>;
  skipNext(): Promise<IpcResult<ReminderStatus>>;
  resume(): Promise<IpcResult<ReminderStatus>>;
  testNotification(): Promise<IpcResult<ReminderStatus>>;
  getStartup(): Promise<IpcResult<StartupStatus>>;
  setLaunchAtLogin(enabled: boolean): Promise<IpcResult<StartupStatus>>;
  setShortcut(accelerator: string): Promise<IpcResult<StartupStatus>>;
  recordShortcut(active: boolean): Promise<IpcResult<null>>;
}
