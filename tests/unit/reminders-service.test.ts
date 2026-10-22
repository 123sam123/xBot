import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundledMigrations, openDatabase, type Db } from '../../src/main/db';
import { migrate } from '../../src/main/db/migrate';
import { createRemindersService, type ReminderIdeas, type ReminderPrefs, type RemindersService } from '../../src/main/services/reminders/service';
import { createReminderStore } from '../../src/main/services/reminders/store';
import type { ServiceContext } from '../../src/main/services/types';
import { EMPTY_STATE, HOUR, MINUTE, type ReminderState } from '../../src/shared/reminders/schedule';
import { installLoopbackFetchSpy } from './helpers/loopbackFetch';
import { chatLines, makeService, ndjson, startMockOllama, type MockOllama, type TestService } from './helpers/mockOllama';
import { cleanupFixtures, makeProjects, quiet } from './helpers/projectFixtures';

// SPEC §13/§22 "Reminder … sleep recovery": the scheduler service with fake
// timers and a fake environment. Missed reminders after sleep collapse into
// one, a cooldown and a snooze survive a restart, a dismissed dropdown isn't
// reopened before the next interval, and a fire with no new project activity
// makes no AI call (against T7's real services and a mock Ollama).

installLoopbackFetchSpy({ expectRequests: true });

const ZONE = 'Europe/Stockholm'; // UTC+2 on Monday 2026-10-19
const at = (iso: string) => Date.parse(iso);

interface Harness {
  service: RemindersService;
  events: ServiceContext['events'];
  env: { idle: number; locked: boolean; modal: boolean; fullScreen: boolean; visible: boolean };
  deliveries: string[];
  stored(): ReminderState;
}

const noIdeas: ReminderIdeas = {
  top: () => null,
  hasNewActivitySince: () => false,
  refresh: async () => ({ status: 'up_to_date' }),
  aiReady: () => true,
};

let open: { service: RemindersService; db: Db | null }[] = [];
let mock: MockOllama | null = null;
let ai: TestService | null = null;
let dir: string | null = null;

afterEach(async () => {
  for (const h of open) {
    h.service.dispose();
    h.db?.close();
  }
  open = [];
  vi.useRealTimers();
  ai?.close();
  ai = null;
  await mock?.close();
  mock = null;
  cleanupFixtures();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function openDb(file = ':memory:'): Db {
  const db = openDatabase(file);
  migrate(db, bundledMigrations());
  return db;
}

/** A service over `db`, with every input faked: the composer, the screen, notifications and T7's ideas. */
function harness(db: Db, { now = () => Date.now(), ideas = noIdeas, ownsDb = true }: { now?: () => number; ideas?: ReminderIdeas; ownsDb?: boolean } = {}): Harness {
  const env = { idle: 0, locked: false, modal: false, fullScreen: false, visible: false };
  const deliveries: string[] = [];
  const events = new EventEmitter() as ServiceContext['events'];
  const store = createReminderStore(db, now);
  const prefs: ReminderPrefs = {
    intervalMinutes: 30,
    workStart: '09:00',
    workEnd: '18:00',
    days: [1, 2, 3, 4, 5],
    dailyCap: 8,
    paused: false,
    autoOpen: true,
    notificationOnly: false,
    onboarded: true,
  };
  const service: RemindersService = createRemindersService({
    store,
    prefs: () => prefs,
    timeZone: () => ZONE,
    probe: {
      idleSeconds: () => env.idle,
      locked: () => env.locked,
      modal: () => env.modal,
      fullScreen: () => env.fullScreen,
      composerVisible: () => env.visible,
    },
    outlet: {
      autoOpen: () => {
        deliveries.push('auto-open');
        env.visible = true;
        return true;
      },
      // What Electron's hide event does: the composer goes away and the service hears about it.
      hideComposer: () => {
        env.visible = false;
        service.composerHidden();
      },
      notificationsSupported: () => true,
      notify: () => {
        deliveries.push('notification');
      },
      closeNotification: () => {},
    },
    ideas,
    events,
    emit: () => {},
    log: quiet,
    now,
  });
  open.push({ service, db: ownsDb ? db : null });
  return { service, events, env, deliveries, stored: () => store.read() };
}

/** Writes a starting state the way a previous run would have left it. */
function seed(db: Db, patch: Partial<ReminderState>): void {
  createReminderStore(db).write({ ...EMPTY_STATE, ...patch });
}

describe('sleep recovery', () => {
  /** Monday: last reminder 09:45, the app running since 09:50; at 10:00 nothing is due yet (10:15). */
  function runningAt10(): Harness {
    vi.useFakeTimers({ now: at('2026-10-19T07:50:00Z') });
    const db = openDb();
    seed(db, { intervalFrom: at('2026-10-19T07:45:00Z'), lastFiredAt: at('2026-10-19T07:45:00Z'), firedCountDate: '2026-10-19', firedCount: 1 });
    const h = harness(db);
    h.service.start();
    vi.advanceTimersByTime(10 * MINUTE);
    expect(h.deliveries).toEqual([]);
    return h;
  }

  it('suspend at 10:00 and resume at 13:00: exactly one reminder fires, never six', () => {
    const h = runningAt10();
    h.service.suspend();
    vi.setSystemTime(at('2026-10-19T11:00:00Z')); // 13:00; no timer ran while asleep
    h.service.resume();
    vi.advanceTimersByTime(MINUTE);
    expect(h.deliveries).toEqual(['auto-open']);
    expect(h.stored().firedCount).toBe(2);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(h.deliveries).toHaveLength(1);
    expect(h.stored().firedCount).toBe(2);
  });

  it('macOS order: the stale timer fires on wake before resume arrives, and still only one fires', () => {
    const h = runningAt10();
    vi.setSystemTime(at('2026-10-19T11:00:00Z'));
    vi.advanceTimersByTime(MINUTE); // the timer armed before sleep runs ~3 h late
    h.service.resume(); // the event arrives afterwards
    vi.advanceTimersByTime(31_000);
    expect(h.deliveries).toEqual(['auto-open']);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(h.deliveries).toHaveLength(1);
    expect(h.stored().firedCount).toBe(2);
  });

  it('waking after working hours fires nothing', () => {
    const h = runningAt10();
    h.service.suspend();
    vi.setSystemTime(at('2026-10-19T17:00:00Z')); // 19:00
    h.service.resume();
    vi.advanceTimersByTime(30 * MINUTE);
    expect(h.deliveries).toEqual([]);
    expect(h.stored().firedCount).toBe(1);
    expect(h.service.status().nextAt).toBe('2026-10-20T07:00:00.000Z'); // Tuesday 09:00
  });
});

describe('restart', () => {
  it('a cooldown and a snooze persisted before a restart are still honoured after it', () => {
    dir = mkdtempSync(join(tmpdir(), 'xbot-reminders-'));
    const file = join(dir, 'xbot.db');
    vi.useFakeTimers({ now: at('2026-10-19T08:00:00Z') }); // Monday 10:00

    // Run 1: a post is published at 10:05; quiet until 11:05.
    let db = openDb(file);
    let h = harness(db);
    h.service.start();
    vi.advanceTimersByTime(5 * MINUTE);
    h.events.emit('post:published', { postId: '1', url: 'https://x.com/i/status/1' });
    expect(h.service.status()).toMatchObject({ nextAt: '2026-10-19T09:05:00.000Z', reason: 'cooldown' });
    h.service.dispose();
    db.close();
    open = [];

    // Run 2 at 10:20 (past the 2 min startup grace): the cooldown still holds. Snooze until 12:30.
    vi.setSystemTime(at('2026-10-19T08:20:00Z'));
    db = openDb(file);
    h = harness(db);
    h.service.start();
    expect(h.service.status()).toMatchObject({ nextAt: '2026-10-19T09:05:00.000Z', reason: 'cooldown' });
    h.service.snooze({ minutes: 130 });
    expect(h.service.status()).toMatchObject({ nextAt: '2026-10-19T10:30:00.000Z', reason: 'snooze' });
    h.service.dispose();
    db.close();
    open = [];

    // Run 3 at 10:40: the snooze still holds, and the reminder comes at 12:30, not before.
    vi.setSystemTime(at('2026-10-19T08:40:00Z'));
    db = openDb(file);
    h = harness(db);
    h.service.start();
    expect(h.service.status()).toMatchObject({ nextAt: '2026-10-19T10:30:00.000Z', reason: 'snooze', snoozedUntil: '2026-10-19T10:30:00.000Z' });
    vi.advanceTimersByTime(at('2026-10-19T10:29:00Z') - Date.now());
    expect(h.deliveries).toEqual([]);
    vi.advanceTimersByTime(2 * MINUTE);
    expect(h.deliveries).toEqual(['auto-open']);
  });
});

describe('dismissal', () => {
  /** Monday 09:55, last reminder 09:30: the next one is due at 10:00. */
  function dueAt10(): Harness {
    vi.useFakeTimers({ now: at('2026-10-19T07:55:00Z') });
    const db = openDb();
    seed(db, { intervalFrom: at('2026-10-19T07:30:00Z') });
    const h = harness(db);
    h.service.start();
    vi.advanceTimersByTime(5 * MINUTE + 1000);
    expect(h.deliveries).toEqual(['auto-open']);
    return h;
  }

  it('an auto-opened composer that is dismissed is not reopened until the next interval', () => {
    const h = dueAt10();
    // 10:01: the user dismisses it (Escape, the menu-bar icon, or a click elsewhere once focused).
    vi.advanceTimersByTime(MINUTE);
    h.env.visible = false;
    h.service.composerHidden();
    // Everything that recomputes the schedule: unlock, wake, a settings edit. None of it reopens it.
    vi.advanceTimersByTime(5 * MINUTE);
    h.service.unlock();
    vi.advanceTimersByTime(MINUTE);
    h.service.resume();
    vi.advanceTimersByTime(MINUTE);
    h.service.settingsChanged('reminders.dailyCap');
    vi.advanceTimersByTime(at('2026-10-19T08:30:00Z') - Date.now()); // 10:30
    expect(h.deliveries).toEqual(['auto-open']);
    // The next interval starts from the dismissal: 10:31.
    vi.advanceTimersByTime(2 * MINUTE);
    expect(h.deliveries).toEqual(['auto-open', 'auto-open']);
  });

  it('an auto-opened composer nobody focuses hides itself after 2 min, which counts as a dismissal', () => {
    const h = dueAt10();
    vi.advanceTimersByTime(2 * MINUTE);
    expect(h.env.visible).toBe(false);
    expect(h.stored().lastDismissedAt).toBe(at('2026-10-19T08:02:00Z')); // two minutes after the 10:00 fire
    vi.advanceTimersByTime(29 * MINUTE); // 10:31
    expect(h.deliveries).toHaveLength(1);
    vi.advanceTimersByTime(2 * MINUTE); // 10:33: one interval after the 10:02 dismissal
    expect(h.deliveries).toHaveLength(2);
  });
});

describe('no AI without new activity', () => {
  /** The DATA block of the prompt whose first line contains `phrase` (T7's ideas cite their sources). */
  function blockFor(body: unknown, phrase: string): string {
    const user = (body as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === 'user')?.content ?? '';
    for (const match of user.matchAll(/<<<DATA name="([A-Z]+\d*)">>>\n([^\n]*)/g)) if (match[2]!.includes(phrase)) return match[1]!;
    return 'N1';
  }

  it('a fire with no new project activity makes 0 AI calls', async () => {
    mock = await startMockOllama();
    mock.routes['POST /api/chat'] = (_req, res, body) =>
      ndjson(
        res,
        chatLines(
          JSON.stringify({
            ideas: [{ kind: 'feature_finished', text: 'Reminders that never nag: one nudge after sleep, not six.', sources: [blockFor(body, 'Note')], claims: [] }],
          }),
        ),
      );
    ai = makeService(mock.endpoint);
    const { projects, ideas } = makeProjects(ai.service, ai.db);
    let refreshes = 0;
    let clock = 0;
    const h = harness(ai.db, {
      now: () => clock,
      ownsDb: false,
      ideas: {
        top: () => ideas.getTopRelevant(),
        hasNewActivitySince: (ms) => projects.hasNewActivitySince(ms),
        refresh: () => {
          refreshes += 1;
          return ideas.refresh('auto', 'background');
        },
        aiReady: () => true,
      },
    });
    const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

    // 1. Activity, then a fire: one generation.
    projects.addNote(null, 'Shipped the reminder scheduler today.');
    await pause();
    clock = Date.now();
    expect(h.service.fireNow()).toBe('auto-open');
    await h.service.whenIdle();
    expect(refreshes).toBe(1);
    expect(mock.hits('/api/chat')).toHaveLength(1);
    expect(h.service.status().cycle?.idea?.text).toMatch(/never nag/);

    // 2. Over two hours later, nothing new: no AI call. The 2 h rule doesn't apply, so this is the activity check.
    clock += 2 * HOUR + MINUTE;
    expect(h.service.fireNow()).not.toBe('hold');
    await h.service.whenIdle();
    expect(refreshes).toBe(1);
    expect(mock.hits('/api/chat')).toHaveLength(1);

    // 3. Control: new activity, over two hours after the last generation, does generate.
    await pause();
    projects.addNote(null, 'Added a snooze menu to the reminder row.');
    clock += 2 * HOUR;
    h.service.fireNow();
    await h.service.whenIdle();
    expect(refreshes).toBe(2);
    expect(mock.hits('/api/chat')).toHaveLength(2);
  });
});
