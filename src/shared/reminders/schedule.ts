// T8 (XBOT-8V5WV5): when the next reminder is due, and how it is delivered.
// Pure: the clock, the zone and the state are arguments, so tests drive it
// with a fake clock. Zone math uses Intl with an explicit IANA zone, never the
// process's own zone (Temporal is not available here). The rules are in
// ARCHITECTURE.md → "Reminders".

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Reminders stay quiet this long after a post is published. */
export const PUBLISH_COOLDOWN_MS = 60 * MINUTE;
/** The first fire after launch waits this long (launch at login, before the menu bar is ready). */
export const STARTUP_GRACE_MS = 2 * MINUTE;
/** A settings edit never makes a reminder due sooner than this. */
export const SETTINGS_FLOOR_MS = MINUTE;
/** No snooze is longer than this; a later `snoozed_until` comes from a clock set backwards. */
export const MAX_SNOOZE_MS = 8 * DAY;
/** How far ahead the window search looks (a week, plus overnight windows). */
const LOOKAHEAD_DAYS = 8;

/** The settings the schedule reads. `days` are ISO weekdays: 1 = Monday … 7 = Sunday. */
export interface ReminderSchedule {
  intervalMinutes: number;
  workStart: string;
  workEnd: string;
  days: readonly number[];
  dailyCap: number;
  paused: boolean;
  timeZone: string;
}

export type SnoozeKind = 'snooze' | 'skip';

/** The persisted state (one `reminder_state` row). Times are epoch ms. */
export interface ReminderState {
  /** The interval counts from here: the last fire, dismissal, unpause, cleared snooze or first run. */
  intervalFrom: number | null;
  lastFiredAt: number | null;
  lastDismissedAt: number | null;
  snoozedUntil: number | null;
  snoozeKind: SnoozeKind | null;
  /** The local date (`YYYY-MM-DD`) `firedCount` counts. */
  firedCountDate: string | null;
  firedCount: number;
  lastPublishedAt: number | null;
  /** When a reminder last started an idea generation. */
  lastGenerationAt: number | null;
}

export const EMPTY_STATE: ReminderState = {
  intervalFrom: null,
  lastFiredAt: null,
  lastDismissedAt: null,
  snoozedUntil: null,
  snoozeKind: null,
  firedCountDate: null,
  firedCount: 0,
  lastPublishedAt: null,
  lastGenerationAt: null,
};

/** Which rule set the due time. */
export type DueReason =
  | 'interval'
  | 'window'
  | 'snooze'
  | 'skip'
  | 'cooldown'
  | 'cap'
  | 'grace'
  | 'settings'
  | 'paused'
  | 'no-days'
  | 'onboarding';

export interface Due {
  at: number | null;
  reason: DueReason;
}

/** In-memory floors and gates the service adds (not persisted). */
export interface DueExtras {
  graceUntil?: number | null;
  settingsUntil?: number | null;
  /** True until the `reminders` onboarding step has been seen. */
  awaitingOnboarding?: boolean;
}

// ---------- Zoned time ----------

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

interface Wall extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(ms: number, timeZone: string): Wall {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(ms)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** The zone's UTC offset at instant `ms`, in ms (east positive). */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}

export function localDate(ms: number, timeZone: string): LocalDate {
  const { year, month, day } = wallClock(ms, timeZone);
  return { year, month, day };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  return ((new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 6) % 7) + 1;
}

export function dateKey(date: LocalDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/**
 * The instant a wall time on `date` happens in `timeZone`. A time in a DST
 * gap moves forward by the gap (02:30 → 03:30, Temporal's "compatible"); a
 * time in an overlap takes the earlier instant.
 */
export function zonedInstant(date: LocalDate, minutesOfDay: number, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minutesOfDay);
  const before = offsetAt(wall - DAY, timeZone);
  const after = offsetAt(wall + DAY, timeZone);
  const valid = [wall - before, wall - after].filter((t) => t + offsetAt(t, timeZone) === wall);
  if (valid.length > 0) return Math.min(...valid);
  return wall - before;
}

/** `HH:MM` → minutes after midnight. */
export function parseClock(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

// ---------- Working windows ----------

interface WorkWindow {
  start: number;
  end: number;
}

/**
 * The working window that starts on `date`, or null on a day off. An end at or
 * before the start runs into the next day (end == start: all day).
 */
function windowOn(date: LocalDate, s: ReminderSchedule): WorkWindow | null {
  if (!s.days.includes(isoWeekday(date))) return null;
  const startMin = parseClock(s.workStart);
  const endMin = parseClock(s.workEnd);
  const start = zonedInstant(date, startMin, s.timeZone);
  const end = zonedInstant(endMin > startMin ? date : addDays(date, 1), endMin, s.timeZone);
  return end > start ? { start, end } : null;
}

/** The earliest moment at or after `t` inside a working window, or null when no day in the next week works. */
function nextWorkingMoment(t: number, s: ReminderSchedule): number | null {
  const today = localDate(t, s.timeZone);
  for (let offset = -1; offset <= LOOKAHEAD_DAYS; offset++) {
    const w = windowOn(addDays(today, offset), s);
    if (w && w.end > t) return Math.max(t, w.start);
  }
  return null;
}

function startOfNextDay(t: number, timeZone: string): number {
  return zonedInstant(addDays(localDate(t, timeZone), 1), 0, timeZone);
}

function capReached(t: number, s: ReminderSchedule, state: ReminderState): boolean {
  return state.firedCountDate === dateKey(localDate(t, s.timeZone)) && state.firedCount >= s.dailyCap;
}

/**
 * When the next reminder is due. The order: pause and the onboarding gate;
 * the latest of the interval, snooze, publish cooldown and in-memory floors;
 * then into the next working window; a day whose cap is reached moves to the
 * next day's window. `at` may be ≤ now: due now.
 */
export function nextDue(now: number, s: ReminderSchedule, state: ReminderState, extras: DueExtras = {}): Due {
  if (s.paused) return { at: null, reason: 'paused' };
  if (extras.awaitingOnboarding) return { at: null, reason: 'onboarding' };
  if (s.days.length === 0) return { at: null, reason: 'no-days' };

  let at = now;
  let reason: DueReason = 'interval';
  const floor = (t: number | null | undefined, why: DueReason) => {
    if (t != null && t > at) {
      at = t;
      reason = why;
    }
  };
  if (state.intervalFrom != null) floor(state.intervalFrom + s.intervalMinutes * MINUTE, 'interval');
  floor(state.snoozedUntil, state.snoozeKind === 'skip' ? 'skip' : 'snooze');
  if (state.lastPublishedAt != null) floor(state.lastPublishedAt + PUBLISH_COOLDOWN_MS, 'cooldown');
  floor(extras.graceUntil, 'grace');
  floor(extras.settingsUntil, 'settings');

  for (let attempt = 0; attempt <= LOOKAHEAD_DAYS; attempt++) {
    const moment = nextWorkingMoment(at, s);
    if (moment === null) return { at: null, reason: 'no-days' };
    if (moment > at) {
      at = moment;
      if (reason !== 'cap') reason = 'window';
    }
    if (!capReached(at, s, state)) return { at, reason };
    at = startOfNextDay(at, s.timeZone);
    reason = 'cap';
  }
  return { at: null, reason: 'no-days' };
}

/** "Snooze until tomorrow": the start of the first working window on a later local date. */
export function nextWindowStartAfterToday(now: number, s: ReminderSchedule): number | null {
  const today = localDate(now, s.timeZone);
  for (let offset = 1; offset <= LOOKAHEAD_DAYS; offset++) {
    const w = windowOn(addDays(today, offset), s);
    if (w) return w.start;
  }
  return null;
}

// ---------- State transitions ----------

/** A reminder fired at `at`: the interval restarts, the day's count goes up, a spent snooze clears. */
export function recordFire(state: ReminderState, at: number, timeZone: string): ReminderState {
  const key = dateKey(localDate(at, timeZone));
  const snoozeSpent = state.snoozedUntil !== null && state.snoozedUntil <= at;
  return {
    ...state,
    intervalFrom: at,
    lastFiredAt: at,
    firedCountDate: key,
    firedCount: state.firedCountDate === key ? state.firedCount + 1 : 1,
    ...(snoozeSpent ? { snoozedUntil: null, snoozeKind: null } : {}),
  };
}

/** The user dismissed the reminder (hid the composer, or Skip on the notification): a full interval from now. */
export function recordDismiss(state: ReminderState, at: number): ReminderState {
  return { ...state, intervalFrom: at, lastDismissedAt: at };
}

export function recordSnooze(state: ReminderState, until: number, kind: SnoozeKind = 'snooze'): ReminderState {
  return { ...state, snoozedUntil: until, snoozeKind: kind };
}

/** "Skip next": the upcoming reminder doesn't happen; the one an interval after it does. */
export function recordSkip(now: number, s: ReminderSchedule, state: ReminderState, extras: DueExtras = {}): ReminderState {
  const due = nextDue(now, s, state, extras);
  if (due.at === null) return state;
  return recordSnooze(state, Math.max(due.at, now) + s.intervalMinutes * MINUTE, 'skip');
}

/** Unpause, a cleared snooze, the end of onboarding or the first run: the interval starts now. */
export function recordResume(state: ReminderState, at: number): ReminderState {
  return { ...state, intervalFrom: at, snoozedUntil: null, snoozeKind: null };
}

export function recordPublished(state: ReminderState, at: number): ReminderState {
  return { ...state, lastPublishedAt: at };
}

/** A clock set backwards must not silence reminders for days: past times can't be in the future. */
export function clampToNow(state: ReminderState, now: number): ReminderState {
  const past = (t: number | null) => (t !== null && t > now ? now : t);
  return {
    ...state,
    intervalFrom: past(state.intervalFrom),
    lastFiredAt: past(state.lastFiredAt),
    lastDismissedAt: past(state.lastDismissedAt),
    lastPublishedAt: past(state.lastPublishedAt),
    lastGenerationAt: past(state.lastGenerationAt),
    snoozedUntil: state.snoozedUntil !== null && state.snoozedUntil > now + MAX_SNOOZE_MS ? now + MAX_SNOOZE_MS : state.snoozedUntil,
  };
}

export function sameState(a: ReminderState, b: ReminderState): boolean {
  return (Object.keys(a) as (keyof ReminderState)[]).every((key) => a[key] === b[key]);
}

// ---------- Delivery ----------

/** What main can see when a reminder is due. None of it watches the screen. */
export interface DeliveryEnv {
  composerVisible: boolean;
  /** No input for a while: nobody would see a reminder. */
  away: boolean;
  locked: boolean;
  /** Another macOS user is active (fast user switching). */
  otherUser: boolean;
  /** A native dialog or picker, the Studio, or a shortcut being recorded. */
  modal: boolean;
  /** Best effort: no menu bar on the tray's display. */
  fullScreen: boolean;
}

export interface DeliveryPrefs {
  autoOpen: boolean;
  notificationOnly: boolean;
}

export type Delivery = 'hold' | 'already-open' | 'auto-open' | 'notification';

/**
 * How a due reminder is delivered. Composer open: nothing pops up. Nobody
 * there: hold. Otherwise the dropdown when it is safe and wanted, else a
 * notification ("Open dropdown" off falls back to the dropdown only when
 * notifications can't be shown; notification-only never does).
 */
export function decideDelivery(env: DeliveryEnv, prefs: DeliveryPrefs, notificationsSupported: boolean): Delivery {
  if (env.composerVisible) return 'already-open';
  if (env.away || env.locked || env.otherUser) return 'hold';
  if (prefs.notificationOnly) return 'notification';
  const safe = !env.modal && !env.fullScreen;
  if (!prefs.autoOpen) return !notificationsSupported && safe ? 'auto-open' : 'notification';
  return safe ? 'auto-open' : 'notification';
}

/** Whether the dropdown may open for a cycle whose notification failed ("Open dropdown" off only). */
export function fallbackToDropdown(env: DeliveryEnv, prefs: DeliveryPrefs): boolean {
  return !prefs.notificationOnly && !prefs.autoOpen && !env.composerVisible && !env.modal && !env.fullScreen && !env.locked && !env.otherUser;
}
