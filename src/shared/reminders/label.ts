// T8 (XBOT-8V5WV5): the reminder row's words. Times read in the zone the
// working hours use, in the user's locale and hour cycle.
import type { ReminderStatus } from '../contracts/reminders';
import { addDays, dateKey, localDate } from './schedule';

const SOON_MS = 90 * 60_000;

function time(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }).format(ms);
}

/** "at 14:30", "tomorrow at 09:00" or "Mon at 09:00", relative to `now`'s local date. */
export function whenPhrase(at: number, now: number, timeZone: string): string {
  const today = localDate(now, timeZone);
  const day = dateKey(localDate(at, timeZone));
  if (day === dateKey(today)) return `at ${time(at, timeZone)}`;
  if (day === dateKey(addDays(today, 1))) return `tomorrow at ${time(at, timeZone)}`;
  return `${new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone }).format(at)} at ${time(at, timeZone)}`;
}

/** "14:30" on the same day, otherwise the same as `whenPhrase` ("until 14:30", "until tomorrow at 09:00"). */
export function untilPhrase(at: number, now: number, timeZone: string): string {
  const phrase = whenPhrase(at, now, timeZone);
  return phrase.startsWith('at ') ? phrase.slice(3) : phrase;
}

/** The composer's reminder row: "Next reminder in 24 min", "Snoozed until 14:30", "Reminders paused", … */
export function reminderLabel(status: ReminderStatus, now: number): string {
  if (!status.enabled) return 'Reminders are off in preview';
  if (status.reason === 'paused') return 'Reminders paused';
  if (status.reason === 'onboarding') return 'Reminders start after setup';
  if (status.nextAt === null) return 'No reminder days chosen';
  const at = Date.parse(status.nextAt);
  if (at <= now) return 'Reminder due';
  const zone = status.timeZone;
  switch (status.reason) {
    case 'snooze':
      return `Snoozed until ${untilPhrase(at, now, zone)}`;
    case 'skip':
      return `Skipped · next reminder ${whenPhrase(at, now, zone)}`;
    case 'cooldown':
      return `Quiet after your post until ${untilPhrase(at, now, zone)}`;
    case 'cap':
      return `Done for today · next ${whenPhrase(at, now, zone)}`;
    default:
      if (at - now < SOON_MS) return `Next reminder in ${Math.ceil((at - now) / 60_000)} min`;
      return `Next reminder ${whenPhrase(at, now, zone)}`;
  }
}

export const NOTIFICATIONS_OFF_HINT = 'Notifications are off for xBot. Turn them on in System Settings → Notifications.';
