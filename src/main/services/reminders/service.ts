// T8 (XBOT-8V5WV5): the reminder scheduler. Electron-free: the clock, the
// environment probe, delivery and T7's ideas are injected, and its inputs
// (suspend, resume, lock, a composer hide, a settings change…) are methods,
// so tests drive it with fake timers. index.ts wires it to Electron. The
// schedule itself is pure (src/shared/reminders/schedule.ts); the rules are
// in ARCHITECTURE.md → "Reminders".
import { randomUUID } from 'node:crypto';
import type { Idea, RefreshResult } from '../../../shared/contracts/projects';
import type { ReminderCycle, ReminderStatus, SnoozePayload } from '../../../shared/contracts/reminders';
import {
  clampToNow,
  dateKey,
  decideDelivery,
  fallbackToDropdown,
  HOUR,
  localDate,
  MINUTE,
  nextDue,
  nextWindowStartAfterToday,
  PUBLISH_COOLDOWN_MS,
  recordDismiss,
  recordFire,
  recordPublished,
  recordResume,
  recordSkip,
  recordSnooze,
  sameState,
  SETTINGS_FLOOR_MS,
  STARTUP_GRACE_MS,
  type Delivery,
  type DeliveryEnv,
  type DeliveryPrefs,
  type DueExtras,
  type ReminderSchedule,
  type ReminderState,
} from '../../../shared/reminders/schedule';
import type { Logger } from '../../log';
import type { ServiceContext } from '../types';
import type { ReminderStore } from './store';

/** The timer is never armed further ahead than this, so clock and zone changes are noticed within a minute. */
export const MAX_WAIT_MS = MINUTE;
/** A tick this late means the machine slept (a timer due during sleep can fire before `resume`). */
export const LATE_TICK_MS = 90_000;
/** After resume or unlock, wait this long before firing, so the user is back first. */
export const SETTLE_MS = 30_000;
/** An auto-opened composer that never takes focus hides itself after this long. */
export const AUTO_HIDE_MS = 2 * MINUTE;
/** A notification that hasn't been shown by then counts as failed (denied permission may say nothing). */
export const SHOW_TIMEOUT_MS = 10_000;
/** No input for this long: the user is away, so a due reminder waits. */
export const AWAY_SECONDS = 5 * 60;
/** A reminder starts at most one idea generation this often. */
export const GENERATION_GAP_MS = 2 * HOUR;
/** Rejections after which nothing was generated, so the next fire may try again. */
const RETRYABLE_REFRESH = new Set(['ai_busy', 'ollama_unavailable', 'model_needed', 'model_unverifiable']);

/** The settings the service reads (the time zone comes from the detector). */
export interface ReminderPrefs extends Omit<ReminderSchedule, 'timeZone'>, DeliveryPrefs {
  /** The `reminders` onboarding step is in `ui.onboardingSeen`. */
  onboarded: boolean;
}

/** What main can see when a reminder is due; none of it watches the screen. */
export interface ReminderProbe {
  idleSeconds(): number;
  locked(): boolean;
  modal(): boolean;
  fullScreen(): boolean;
  composerVisible(): boolean;
}

export interface ReminderOutlet {
  /** Shows the composer without focus; false when it can't. */
  autoOpen(): boolean;
  hideComposer(): void;
  notificationsSupported(): boolean;
  /** Shows the reminder notification; `show` / `failed` come back through `notificationResult`. */
  notify(cycleId: string, body: string): void;
  closeNotification(): void;
}

export interface ReminderIdeas {
  top(): Idea | null;
  hasNewActivitySince(ms: number): boolean;
  refresh(): Promise<RefreshResult>;
  aiReady(): boolean;
}

export interface RemindersDeps {
  store: ReminderStore;
  prefs(): ReminderPrefs;
  timeZone(): string;
  probe: ReminderProbe;
  outlet: ReminderOutlet;
  ideas: ReminderIdeas;
  /** The app's event bus: `post:published` and `projects:ideas-changed` are read from it. */
  events: Pick<ServiceContext['events'], 'on' | 'off'>;
  emit(status: ReminderStatus): void;
  log: Logger;
  now?(): number;
  preview?: boolean;
  /** False in e2e runs: only `fireNow()` fires. */
  autoSchedule?: boolean;
}

interface LiveCycle extends ReminderCycle {
  firedMs: number;
  hideTimer: ReturnType<typeof setTimeout> | null;
  showTimer: ReturnType<typeof setTimeout> | null;
}

export type RemindersService = ReturnType<typeof createRemindersService>;

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function createRemindersService(deps: RemindersDeps) {
  const now = () => deps.now?.() ?? Date.now();
  const { store, log } = deps;
  const preview = deps.preview ?? false;
  const autoSchedule = deps.autoSchedule ?? true;

  let state: ReminderState = clampToNow(store.read(), now());
  let started = false;
  let disposed = false;
  let startedAt = now();
  let settingsUntil: number | null = null;
  let onboarded = deps.prefs().onboarded;
  let lockedByEvent = false;
  let otherUser = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let expectedAt: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let cycle: LiveCycle | null = null;
  let notifications: ReminderStatus['notifications'] = 'ok';
  let firing = false;
  let refreshing: Promise<void> | null = null;
  let lastEmitted = '';
  let heldFor: number | null = null;

  const schedule = (prefs = deps.prefs()): ReminderSchedule => ({
    intervalMinutes: prefs.intervalMinutes,
    workStart: prefs.workStart,
    workEnd: prefs.workEnd,
    days: prefs.days,
    dailyCap: prefs.dailyCap,
    paused: prefs.paused,
    timeZone: deps.timeZone(),
  });
  const extras = (prefs = deps.prefs()): DueExtras => ({
    graceUntil: startedAt + STARTUP_GRACE_MS,
    settingsUntil,
    awaitingOnboarding: !prefs.onboarded,
  });

  function save(next: ReminderState): void {
    if (sameState(next, state)) return;
    state = next;
    if (!preview) store.write(state);
  }

  function status(): ReminderStatus {
    const at = now();
    const prefs = deps.prefs();
    const s = schedule(prefs);
    const due = preview ? { at: null, reason: 'paused' as const } : nextDue(at, s, state, extras(prefs));
    const today = dateKey(localDate(at, s.timeZone));
    const firedToday = state.firedCountDate === today ? state.firedCount : 0;
    const cooldownEnd = state.lastPublishedAt === null ? null : state.lastPublishedAt + PUBLISH_COOLDOWN_MS;
    return {
      enabled: !preview,
      nextAt: iso(due.at),
      reason: due.reason,
      snoozedUntil: state.snoozedUntil !== null && state.snoozedUntil > at ? iso(state.snoozedUntil) : null,
      snoozeKind: state.snoozedUntil !== null && state.snoozedUntil > at ? state.snoozeKind : null,
      cooldownUntil: cooldownEnd !== null && cooldownEnd > at ? iso(cooldownEnd) : null,
      firedToday,
      dailyCap: s.dailyCap,
      capReached: firedToday >= s.dailyCap,
      timeZone: s.timeZone,
      cycle: cycle ? { id: cycle.id, firedAt: cycle.firedAt, delivery: cycle.delivery, idea: cycle.idea } : null,
      notifications,
    };
  }

  function emitStatus(): void {
    if (disposed) return;
    const next = status();
    const key = JSON.stringify(next);
    if (key === lastEmitted) return;
    lastEmitted = key;
    deps.emit(next);
  }

  function env(): DeliveryEnv {
    const p = deps.probe;
    return {
      composerVisible: p.composerVisible(),
      away: p.idleSeconds() >= AWAY_SECONDS,
      locked: lockedByEvent || p.locked(),
      otherUser,
      modal: p.modal(),
      fullScreen: p.fullScreen(),
    };
  }

  // ---------- Cycles ----------

  function clearCycleTimers(c: LiveCycle): void {
    if (c.hideTimer) clearTimeout(c.hideTimer);
    if (c.showTimer) clearTimeout(c.showTimer);
    c.hideTimer = null;
    c.showTimer = null;
  }

  /** Ends the live cycle (dismissed, snoozed, skipped, paused, published or replaced). */
  function endCycle(): void {
    if (!cycle) return;
    clearCycleTimers(cycle);
    if (cycle.delivery === 'notification') deps.outlet.closeNotification();
    cycle = null;
  }

  function openDropdown(c: LiveCycle): boolean {
    if (!deps.outlet.autoOpen()) return false;
    c.delivery = 'auto-open';
    c.hideTimer = setTimeout(() => {
      // Never focused: an unfocused panel gets no blur, so nothing else would close it.
      if (cycle === c) deps.outlet.hideComposer();
    }, AUTO_HIDE_MS);
    return true;
  }

  function sendNotification(c: LiveCycle): void {
    c.delivery = 'notification';
    deps.outlet.notify(c.id, c.idea ? 'An idea is waiting in xBot.' : 'What did you build today?');
    c.showTimer = setTimeout(() => notificationResult(c.id, 'failed'), SHOW_TIMEOUT_MS);
  }

  function maybeRefreshIdeas(at: number): void {
    const { ideas } = deps;
    try {
      const last = state.lastGenerationAt;
      if (!ideas.aiReady()) return;
      if (last !== null && at - last < GENERATION_GAP_MS) return;
      if (!ideas.hasNewActivitySince(last ?? 0)) return;
      save({ ...state, lastGenerationAt: at });
      const restore = () => {
        if (state.lastGenerationAt === at) save({ ...state, lastGenerationAt: last });
      };
      refreshing = ideas
        .refresh()
        .then((result) => {
          if (result.status === 'cancelled') restore();
        })
        .catch((err: unknown) => {
          const code = (err as { code?: unknown })?.code;
          if (typeof code === 'string' && RETRYABLE_REFRESH.has(code)) restore();
          log.warn('reminders: idea refresh failed', code ?? err);
        })
        .finally(() => {
          refreshing = null;
          if (cycle && !cycle.idea) cycle.idea = safeTop();
          emitStatus();
        });
    } catch (err) {
      log.warn('reminders: could not check for new project activity', err);
    }
  }

  function safeTop(): Idea | null {
    try {
      return deps.ideas.top();
    } catch (err) {
      log.warn('reminders: could not read the top idea', err);
      return null;
    }
  }

  /** Delivers one reminder now (the due time was checked by the caller). Returns how, or 'hold'. */
  function fire(at: number): Delivery {
    if (firing || disposed || preview) return 'hold';
    firing = true;
    try {
      const prefs = deps.prefs();
      const e = env();
      const delivery = decideDelivery(e, prefs, deps.outlet.notificationsSupported());
      if (delivery === 'hold') {
        if (heldFor !== state.intervalFrom) log.info('reminders: due, held until someone is there', { locked: e.locked, away: e.away });
        heldFor = state.intervalFrom;
        return 'hold';
      }
      heldFor = null;
      endCycle();
      // State first: a crash after delivery must not deliver it again.
      save(recordFire(state, at, deps.timeZone()));
      const c: LiveCycle = {
        id: randomUUID(),
        firedAt: new Date(at).toISOString(),
        firedMs: at,
        delivery,
        idea: safeTop(),
        hideTimer: null,
        showTimer: null,
      };
      cycle = c;
      maybeRefreshIdeas(at);
      if (delivery === 'auto-open' && !openDropdown(c)) sendNotification(c);
      else if (delivery === 'notification') sendNotification(c);
      if (!deps.outlet.notificationsSupported()) notifications = 'unsupported';
      log.info('reminders: fired', { delivery: c.delivery, idea: c.idea !== null });
      return c.delivery;
    } finally {
      firing = false;
      emitStatus();
    }
  }

  // ---------- The timer ----------

  function clearTimer(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    expectedAt = null;
  }

  function arm(): void {
    clearTimer();
    if (disposed || !started || !autoSchedule || preview) return;
    const at = now();
    const due = nextDue(at, schedule(), state, extras());
    const wait = due.at === null ? MAX_WAIT_MS : Math.min(MAX_WAIT_MS, Math.max(0, due.at - at));
    expectedAt = at + wait;
    timer = setTimeout(tick, wait);
  }

  function settle(): void {
    clearTimer();
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      tick();
    }, SETTLE_MS);
  }

  function tick(): void {
    timer = null;
    if (disposed || !started) return;
    const at = now();
    if (expectedAt !== null) {
      const late = at - expectedAt;
      expectedAt = null;
      if (late > LATE_TICK_MS) {
        log.info('reminders: timer ran late, treating it as a wake from sleep', { lateMs: late });
        settle();
        return;
      }
      if (late > 5000) log.info('reminders: timer ran late', { lateMs: late });
    }
    save(clampToNow(state, at));
    const due = nextDue(at, schedule(), state, extras());
    if (due.at !== null && due.at <= at) fire(at);
    arm();
    emitStatus();
  }

  function rearm(): void {
    if (started && !settleTimer) arm();
    emitStatus();
  }

  // ---------- Inputs ----------

  function notificationResult(cycleId: string, result: 'shown' | 'failed'): void {
    const c = cycle;
    if (!c || c.id !== cycleId || c.delivery !== 'notification') return;
    if (c.showTimer) clearTimeout(c.showTimer);
    c.showTimer = null;
    if (result === 'shown') {
      notifications = 'ok';
    } else {
      notifications = 'failed';
      log.warn('reminders: the notification was not shown');
      if (fallbackToDropdown(env(), deps.prefs())) openDropdown(c);
    }
    emitStatus();
  }

  function snooze(payload: SnoozePayload): ReminderStatus {
    if (preview) return status();
    const at = now();
    const until = 'minutes' in payload ? at + payload.minutes * MINUTE : (nextWindowStartAfterToday(at, schedule()) ?? at + 24 * HOUR);
    endCycle();
    save(recordSnooze(state, until));
    rearm();
    return status();
  }

  const onPublished = () => {
    if (preview) return;
    endCycle();
    save(recordPublished(state, now()));
    rearm();
  };
  const onIdeasChanged = () => {
    if (!cycle) return;
    cycle.idea = safeTop();
    emitStatus();
  };
  deps.events.on('post:published', onPublished);
  deps.events.on('projects:ideas-changed', onIdeasChanged);

  return {
    status,
    /** Starts the timer (after the windows and tray exist). */
    start(): void {
      if (started || disposed || preview) return;
      started = true;
      const at = now();
      startedAt = at;
      // First run: the interval starts now, so a fresh install never fires at once.
      if (state.intervalFrom === null) save(recordResume(state, at));
      arm();
      emitStatus();
    },
    suspend(): void {
      clearTimer();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
    },
    resume(): void {
      if (started) settle();
    },
    lock(): void {
      lockedByEvent = true;
    },
    unlock(): void {
      lockedByEvent = false;
      if (started) settle();
    },
    /** Another macOS user became active (fast user switching). */
    resignActive(): void {
      otherUser = true;
    },
    becomeActive(): void {
      otherUser = false;
      if (started) settle();
    },
    /** The composer hid: during a live cycle that is a dismissal, and the next reminder waits a full interval. */
    composerHidden(): void {
      if (!cycle || preview) return;
      endCycle();
      save(recordDismiss(state, now()));
      rearm();
    },
    /** The user engaged with an auto-opened composer: it stays. */
    composerFocused(): void {
      if (cycle?.hideTimer) {
        clearTimeout(cycle.hideTimer);
        cycle.hideTimer = null;
      }
    },
    notificationResult,
    /** The notification's Snooze / Skip; ignored when it belongs to an earlier cycle. */
    notificationAction(cycleId: string, action: 'snooze' | 'skip'): void {
      if (!cycle || cycle.id !== cycleId) return;
      if (action === 'snooze') snooze({ minutes: 30 });
      else {
        endCycle();
        save(recordDismiss(state, now()));
        rearm();
      }
    },
    settingsChanged(key: string): void {
      if (preview) return;
      const at = now();
      if (key === 'ui.onboardingSeen') {
        const next = deps.prefs().onboarded;
        if (next && !onboarded) save(recordResume(state, at));
        onboarded = next;
      } else if (key.startsWith('reminders.') && key !== 'reminders.shortcut') {
        settingsUntil = at + SETTINGS_FLOOR_MS;
        if (key === 'reminders.paused') {
          if (deps.prefs().paused) endCycle();
          else save(recordResume(state, at));
        }
      } else {
        return;
      }
      rearm();
    },
    snooze,
    skipNext(): ReminderStatus {
      if (preview) return status();
      endCycle();
      save(recordSkip(now(), schedule(), state, extras()));
      rearm();
      return status();
    },
    /** Clears a snooze; the interval restarts now. */
    clearSnooze(): ReminderStatus {
      if (preview) return status();
      save(recordResume(state, now()));
      rearm();
      return status();
    },
    /** Fires one reminder now, whatever the schedule says (the e2e seam); the delivery rules still apply. */
    fireNow(): Delivery {
      return fire(now());
    },
    /** Resolves once a fire's background idea refresh has settled. */
    whenIdle(): Promise<void> {
      return refreshing ?? Promise.resolve();
    },
    /** A test notification for onboarding (asks macOS for permission). */
    testNotification(cycleId: string): void {
      deps.outlet.notify(cycleId, 'Reminders will look like this.');
    },
    setNotifications(value: ReminderStatus['notifications']): void {
      notifications = value;
      emitStatus();
    },
    dispose(): void {
      disposed = true;
      clearTimer();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
      endCycle();
      deps.events.off('post:published', onPublished);
      deps.events.off('projects:ideas-changed', onIdeasChanged);
    },
  };
}
