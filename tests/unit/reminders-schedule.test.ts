import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  MINUTE,
  nextDue,
  recordFire,
  recordPublished,
  recordResume,
  recordSnooze,
  zonedInstant,
  type ReminderSchedule,
  type ReminderState,
} from '../../src/shared/reminders/schedule';

// SPEC §13/§22 "Reminder quiet hours, snooze": the pure schedule against a
// fake clock. Every case names its zone, so the machine's own zone (and
// V8's cached one) never matters.

const STOCKHOLM = 'Europe/Stockholm';
const NEW_YORK = 'America/New_York';
const KOLKATA = 'Asia/Kolkata';

const weekdays: ReminderSchedule = {
  intervalMinutes: 30,
  workStart: '09:00',
  workEnd: '18:00',
  days: [1, 2, 3, 4, 5],
  dailyCap: 8,
  paused: false,
  timeZone: STOCKHOLM,
};

const at = (iso: string) => Date.parse(iso);
const state = (patch: Partial<ReminderState> = {}): ReminderState => ({ ...EMPTY_STATE, ...patch });

/** "Mon 09:00" in `zone`, for readable assertions. */
function local(ms: number | null, zone = STOCKHOLM): string {
  if (ms === null) return 'never';
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(ms)
    .replace(',', '');
}

// Monday 2026-10-19 … Sunday 2026-10-25 (Stockholm is UTC+2 until the 25th, 03:00).
const MON_0700 = at('2026-10-19T05:00:00Z');
const MON_1000 = at('2026-10-19T08:00:00Z');

describe('working hours and days', () => {
  it('waits for the window to open, and skips the evening and the weekend', () => {
    expect(nextDue(MON_0700, weekdays, state({ intervalFrom: MON_0700 - 12 * 60 * MINUTE }))).toEqual({ at: at('2026-10-19T07:00:00Z'), reason: 'window' });
    expect(local(nextDue(at('2026-10-19T16:30:00Z'), weekdays, state({ intervalFrom: at('2026-10-19T15:55:00Z') })).at)).toBe('Tue 09:00');
    expect(local(nextDue(at('2026-10-23T16:30:00Z'), weekdays, state({ intervalFrom: at('2026-10-23T15:55:00Z') })).at)).toBe('Mon 09:00');
    expect(local(nextDue(at('2026-10-24T10:00:00Z'), weekdays, state()).at)).toBe('Mon 09:00');
  });

  it('a whole simulated week fires only inside Mon–Fri 09:00–18:00', () => {
    let t = at('2026-10-18T22:00:00Z'); // Monday 00:00 local
    let s = state({ intervalFrom: t });
    const end = at('2026-10-25T23:00:00Z');
    const fires: string[] = [];
    for (;;) {
      const due = nextDue(t, weekdays, s);
      if (due.at === null || due.at > end) break;
      fires.push(local(due.at));
      s = recordFire(s, due.at, STOCKHOLM);
      t = due.at;
    }
    expect(fires.length).toBe(40); // 8 a day (the cap), 5 days
    for (const fire of fires) {
      const [day, time] = fire.split(' ') as [string, string];
      expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).toContain(day);
      expect(time >= '09:00' && time < '18:00').toBe(true);
    }
    expect(fires.slice(0, 3)).toEqual(['Mon 09:00', 'Mon 09:30', 'Mon 10:00']);
  });

  it('an interval longer than the window gives one reminder a day, at the window start', () => {
    const short: ReminderSchedule = { ...weekdays, workStart: '09:00', workEnd: '10:00', intervalMinutes: 120 };
    const fired = recordFire(state(), at('2026-10-19T07:00:00Z'), STOCKHOLM);
    expect(local(nextDue(at('2026-10-19T07:01:00Z'), short, fired).at)).toBe('Tue 09:00');
  });
});

describe('DST and time-zone boundaries', () => {
  it('a start time in the spring-forward gap moves past it; one in the fall-back overlap takes the earlier instant', () => {
    expect(new Date(zonedInstant({ year: 2026, month: 3, day: 8 }, 2 * 60 + 30, NEW_YORK)).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(new Date(zonedInstant({ year: 2026, month: 11, day: 1 }, 60 + 30, NEW_YORK)).toISOString()).toBe('2026-11-01T05:30:00.000Z');

    const nightOwl: ReminderSchedule = { ...weekdays, timeZone: NEW_YORK, workStart: '02:30', workEnd: '06:00', days: [7] };
    expect(nextDue(at('2026-03-08T05:00:00Z'), nightOwl, state()).at).toBe(at('2026-03-08T07:30:00Z'));
  });

  it('the interval is real time across a DST change, and the window follows the new offset', () => {
    const allWeek: ReminderSchedule = { ...weekdays, days: [1, 2, 3, 4, 5, 6, 7], workStart: '00:00', workEnd: '00:00' };
    // 01:50 CET on 2026-03-29; the clocks jump from 02:00 to 03:00.
    const due = nextDue(at('2026-03-29T00:55:00Z'), allWeek, state({ intervalFrom: at('2026-03-29T00:50:00Z') }));
    expect(due.at).toBe(at('2026-03-29T01:20:00Z'));
    expect(local(due.at)).toBe('Sun 03:20');
    // After the autumn change (2026-10-25) 09:00 is UTC+1.
    expect(nextDue(at('2026-10-24T10:00:00Z'), weekdays, state()).at).toBe(at('2026-10-26T08:00:00Z'));
  });

  it('an overnight window belongs to its start day and runs past midnight', () => {
    const late: ReminderSchedule = { ...weekdays, workStart: '22:00', workEnd: '02:00', days: [5] };
    // Saturday 01:00 is still Friday's window.
    const satNight = at('2026-10-23T23:00:00Z');
    expect(nextDue(satNight, late, state({ intervalFrom: satNight - 60 * MINUTE }))).toEqual({ at: satNight, reason: 'interval' });
    // Saturday 03:00: the next window is Friday at 22:00 (after the autumn change, UTC+1).
    expect(nextDue(at('2026-10-24T01:00:00Z'), late, state()).at).toBe(at('2026-10-30T21:00:00Z'));
  });

  it('the same moment and state give different due times in different zones', () => {
    const noonUtc = at('2026-10-19T12:00:00Z');
    const s = state({ intervalFrom: noonUtc - 60 * MINUTE });
    expect(nextDue(noonUtc, weekdays, s).at).toBe(noonUtc); // 14:00 in Stockholm: due now
    expect(nextDue(noonUtc, { ...weekdays, timeZone: NEW_YORK }, s).at).toBe(at('2026-10-19T13:00:00Z')); // 08:00 in New York: at 09:00
  });

  it('a half-hour offset zone (+05:30)', () => {
    expect(nextDue(at('2026-10-19T03:00:00Z'), { ...weekdays, timeZone: KOLKATA }, state()).at).toBe(at('2026-10-19T03:30:00Z'));
  });

  it('start == end is all day', () => {
    const allDay: ReminderSchedule = { ...weekdays, workStart: '07:00', workEnd: '07:00' };
    const s = state({ intervalFrom: at('2026-10-19T21:00:00Z') });
    expect(local(nextDue(at('2026-10-19T21:05:00Z'), allDay, s).at)).toBe('Mon 23:30');
  });
});

describe('snooze', () => {
  it('moves the next due time, and is spent once it fires', () => {
    const s = state({ intervalFrom: MON_1000 });
    expect(nextDue(MON_1000 + 5 * MINUTE, weekdays, s)).toEqual({ at: MON_1000 + 30 * MINUTE, reason: 'interval' });
    const snoozed = recordSnooze(s, MON_1000 + 65 * MINUTE);
    expect(nextDue(MON_1000 + 5 * MINUTE, weekdays, snoozed)).toEqual({ at: MON_1000 + 65 * MINUTE, reason: 'snooze' });
    const fired = recordFire(snoozed, MON_1000 + 65 * MINUTE, STOCKHOLM);
    expect(fired.snoozedUntil).toBeNull();
    expect(nextDue(MON_1000 + 66 * MINUTE, weekdays, fired).at).toBe(MON_1000 + 95 * MINUTE);
  });

  it('a snooze that ends after the window closes waits for the next working day', () => {
    const at1750 = at('2026-10-23T15:50:00Z'); // Friday 17:50
    const snoozed = recordSnooze(state({ intervalFrom: at1750 }), at1750 + 60 * MINUTE);
    expect(local(nextDue(at1750, weekdays, snoozed).at)).toBe('Mon 09:00');
  });
});

describe('pause', () => {
  it('holds until it is lifted, then the interval starts from the moment it was', () => {
    const paused = { ...weekdays, paused: true };
    const s = state({ intervalFrom: MON_1000 - 3 * 60 * MINUTE });
    for (let hour = 0; hour < 24 * 7; hour += 1) {
      expect(nextDue(MON_1000 + hour * 60 * MINUTE, paused, s)).toEqual({ at: null, reason: 'paused' });
    }
    const lifted = recordResume(s, MON_1000 + 2 * 60 * MINUTE);
    expect(nextDue(MON_1000 + 2 * 60 * MINUTE, weekdays, lifted).at).toBe(MON_1000 + 150 * MINUTE);
  });
});

describe('daily cap', () => {
  it('stops firing for the day once reached, and starts again the next working day', () => {
    let s = state();
    for (let i = 0; i < 8; i++) s = recordFire(s, MON_1000 + i * 30 * MINUTE, STOCKHOLM);
    expect(s.firedCount).toBe(8);
    const due = nextDue(MON_1000 + 4 * 60 * MINUTE, weekdays, s);
    expect(due.reason).toBe('cap');
    expect(local(due.at)).toBe('Tue 09:00');
  });

  it('counts per local date, so it resets at midnight even inside an overnight window', () => {
    const late: ReminderSchedule = { ...weekdays, workStart: '22:00', workEnd: '02:00', days: [5], dailyCap: 1 };
    const fri2230 = at('2026-10-23T20:30:00Z');
    const s = recordFire(state(), fri2230, STOCKHOLM);
    expect(local(nextDue(fri2230 + MINUTE, { ...late, intervalMinutes: 5 }, s).at)).toBe('Sat 00:00');
  });
});

describe('post-publish cooldown', () => {
  it('stays quiet for 60 min after post:published', () => {
    const s = recordPublished(state({ intervalFrom: MON_1000 }), MON_1000 + 10 * MINUTE);
    expect(nextDue(MON_1000 + 11 * MINUTE, weekdays, s)).toEqual({ at: MON_1000 + 70 * MINUTE, reason: 'cooldown' });
    // Once the cooldown is over, the interval rules again.
    expect(nextDue(MON_1000 + 71 * MINUTE, weekdays, recordFire(s, MON_1000 + 70 * MINUTE, STOCKHOLM)).at).toBe(MON_1000 + 100 * MINUTE);
  });
});
