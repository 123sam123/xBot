// Owned by T8 (XBOT-8V5WV5). Already wired into services/index.ts (after
// projects, whose ideas it shows). The only reminders module that imports
// electron: it feeds powerMonitor, the composer, notifications, the login
// item and the global shortcut to the electron-free scheduler (service.ts).
// `init` creates the service; `startReminders()` (app.ts, once the windows
// and tray exist) starts the timer and everything that needs them.
import { app, globalShortcut, Notification, powerMonitor } from 'electron';
import type { ReminderStatus, StartupStatus } from '../../../shared/contracts/reminders';
import { formatAccelerator, sameShortcut, shortcutProblem } from '../../../shared/reminders/shortcut';
import type { Delivery } from '../../../shared/reminders/schedule';
import type { Logger } from '../../log';
import { isPreviewMode } from '../../paths';
import { isHeld } from '../../windows/hold';
import {
  composerDisplay,
  composerWindow,
  hideComposer,
  isComposerVisible,
  onComposerFocused,
  onComposerHidden,
  showComposer,
  showComposerInactive,
  toggleComposer,
} from '../../windows/composer';
import { studioWindow } from '../../windows/studio';
import { ai } from '../ai';
import { projects, suggestions } from '../projects';
import { settings } from '../settings';
import type { ServiceContext, ServiceModule } from '../types';
import { createRemindersService, type ReminderPrefs, type RemindersService } from './service';
import { createReminderStore } from './store';
import { detectTimeZone } from './timeZone';

/** One id for every reminder, so a new one replaces the last in Notification Center. */
const NOTIFICATION_ID = 'xbot-reminder';
const mac = process.platform === 'darwin';

let instance: RemindersService | null = null;
let logger: Logger | null = null;
let events: ServiceContext['events'] | null = null;
let live: Notification | null = null;
let cleanup: (() => void)[] = [];
let startedReminders = false;

// The global shortcut: what is registered, the setting value last accepted, and the last error.
let registered: string | null = null;
let applied: string | null = null;
let shortcutError: string | null = null;
let recording = false;
let loginNote: string | null = null;

export function reminders(): RemindersService {
  if (!instance) throw new Error('reminders service used before initServices()');
  return instance;
}

function prefs(): ReminderPrefs {
  const s = settings();
  return {
    intervalMinutes: s.get('reminders.intervalMinutes'),
    workStart: s.get('reminders.workStart'),
    workEnd: s.get('reminders.workEnd'),
    days: s.get('reminders.days'),
    dailyCap: s.get('reminders.dailyCap'),
    paused: s.get('reminders.paused'),
    autoOpen: s.get('reminders.autoOpen'),
    notificationOnly: s.get('reminders.notificationOnly'),
    onboarded: s.get('ui.onboardingSeen').includes('reminders'),
  };
}

/**
 * Best-effort full-screen guess without watching the screen: on macOS the menu
 * bar is gone from the display the composer would open on (its work area is
 * the whole display). See ARCHITECTURE.md → "Reminders" for what this misses.
 */
function looksFullScreen(): boolean {
  if (!mac) return false;
  const { bounds, workArea } = composerDisplay();
  return workArea.y === bounds.y && workArea.height === bounds.height;
}

function xbotModalOpen(): boolean {
  const studio = studioWindow();
  const composer = composerWindow();
  return recording || (studio !== null && (studio.isVisible() || isHeld(studio.webContents))) || (composer !== null && isHeld(composer.webContents));
}

function closeNotification(): void {
  live?.close();
  live = null;
}

/** Shows the reminder (or onboarding's sample) notification; results go to `onResult`. */
function showNotification(body: string, onResult: (result: 'shown' | 'failed') => void, cycleId: string | null): void {
  closeNotification();
  if (!Notification.isSupported()) {
    onResult('failed');
    return;
  }
  const n = new Notification({
    id: NOTIFICATION_ID,
    title: 'Share what you’re building',
    body,
    actions: cycleId
      ? [
          { type: 'button', text: 'Write Post' },
          { type: 'button', text: 'Snooze 30 min' },
          { type: 'button', text: 'Skip' },
        ]
      : [],
  });
  n.on('show', () => onResult('shown'));
  n.on('failed', (_event, error) => {
    logger?.warn('reminders: notification failed', error);
    onResult('failed');
  });
  // A click (or Write Post) opens the composer even for an earlier reminder.
  n.on('click', () => showComposer());
  n.on('action', (details, index) => {
    const action = details?.actionIndex ?? index;
    if (action === 0) showComposer();
    else if (cycleId && action === 1) instance?.notificationAction(cycleId, 'snooze');
    else if (cycleId && action === 2) instance?.notificationAction(cycleId, 'skip');
  });
  // Kept at module level: a collected Notification loses its click handlers.
  live = n;
  n.show();
}

// ---------- Launch at login ----------

function launchAtLoginStatus(): StartupStatus['launchAtLogin'] {
  const off = (note: string) => ({ available: false, enabled: false, needsApproval: false, note });
  if (!mac && process.platform !== 'win32') return off('Launch at login is available on macOS.');
  // A development run would register the Electron binary itself as a login item.
  if (!app.isPackaged) return off('Launch at login works in the packaged app.');
  if (mac && !app.isInApplicationsFolder()) return off('Move xBot to the Applications folder first.');
  const item = app.getLoginItemSettings();
  const needsApproval = item.status === 'requires-approval';
  return {
    available: true,
    enabled: item.openAtLogin,
    needsApproval,
    note: needsApproval ? 'Approve xBot in System Settings → General → Login Items.' : loginNote,
  };
}

export function setLaunchAtLogin(enabled: boolean): StartupStatus {
  if (launchAtLoginStatus().available) {
    app.setLoginItemSettings({ openAtLogin: enabled });
    // The call fails silently; read the item back.
    const item = app.getLoginItemSettings();
    loginNote =
      item.openAtLogin === enabled || item.status === 'requires-approval'
        ? null
        : 'macOS didn’t change the login item. Try again, or use System Settings → General → Login Items.';
    if (loginNote) logger?.warn('reminders: login item did not change', { wanted: enabled, status: item.status });
  }
  return startupStatus();
}

// ---------- Global shortcut ----------

function stopRecording(): void {
  if (!recording) return;
  recording = false;
  globalShortcut.setSuspended(false);
}

/** Registers `next` in place of the current shortcut; on failure the old one stays. Returns the error, or null. */
function applyShortcut(next: string): string | null {
  // Registrations fail while handling is suspended.
  stopRecording();
  if (registered !== null && next !== '' && sameShortcut(registered, next, mac) && globalShortcut.isRegistered(registered)) {
    shortcutError = null;
    return null;
  }
  const problem = shortcutProblem(next, mac);
  if (problem) {
    shortcutError = problem;
    return problem;
  }
  const previous = registered;
  if (previous) globalShortcut.unregister(previous);
  registered = null;
  shortcutError = null;
  if (next === '') return null;
  let ok = false;
  try {
    ok = globalShortcut.register(next, () => toggleComposer());
  } catch (err) {
    logger?.warn('reminders: could not register the shortcut', next, err);
  }
  if (ok) {
    registered = next;
    return null;
  }
  if (previous && globalShortcut.register(previous, () => toggleComposer())) registered = previous;
  shortcutError = `${formatAccelerator(next, mac)} is already used by another app. Choose another shortcut.`;
  return shortcutError;
}

/** `reminders:set-shortcut`: registered first, saved only when that worked. */
export function setShortcut(accelerator: string): StartupStatus {
  if (!isPreviewMode(process.argv, process.env) && !applyShortcut(accelerator)) {
    applied = accelerator;
    settings().set('reminders.shortcut', accelerator);
  }
  return startupStatus();
}

/** Suspends global shortcuts while the settings field records one, so pressing the current one doesn't toggle the composer. */
export function recordShortcut(active: boolean): void {
  if (active === recording) return;
  recording = active;
  globalShortcut.setSuspended(active);
}

/** A `settings:set` from anywhere goes through the same register-first path; a failure writes the old value back. */
function onShortcutSetting(next: string): void {
  if (next === applied) return;
  const previous = applied;
  if (applyShortcut(next) === null) {
    applied = next;
    return;
  }
  // After this emit reaches the renderers, so they end on the restored value.
  setImmediate(() => {
    if (previous !== null && settings().get('reminders.shortcut') === next) settings().set('reminders.shortcut', previous);
  });
}

export function startupStatus(): StartupStatus {
  return {
    launchAtLogin: launchAtLoginStatus(),
    shortcut: {
      accelerator: settings().get('reminders.shortcut'),
      registered: registered !== null,
      error: shortcutError,
    },
  };
}

// ---------- Notifications from the outside ----------

/** Onboarding's "Send a test notification": macOS asks for permission now, not at the first reminder. */
export function sendTestNotification(): ReminderStatus {
  const service = reminders();
  showNotification('Reminders will look like this.', (result) => service.setNotifications(result === 'shown' ? 'ok' : 'failed'), null);
  return service.status();
}

/** The e2e seam (`__xbotTest.fireReminder`): one reminder now, through the real delivery rules. */
export function fireReminderNow(): Delivery {
  return reminders().fireNow();
}

/** Starts the scheduler and everything that needs the windows and tray. Called once from app.ts. */
export function startReminders(): void {
  if (!instance || startedReminders || isPreviewMode(process.argv, process.env)) return;
  startedReminders = true;
  const service = instance;
  const bus = events!;

  // A notification left over from the last run would do nothing when clicked.
  if (mac) Notification.remove(NOTIFICATION_ID);

  const onSuspend = () => service.suspend();
  const onResume = () => service.resume();
  const onLock = () => service.lock();
  const onUnlock = () => service.unlock();
  const onResign = () => service.resignActive();
  const onBecome = () => service.becomeActive();
  powerMonitor.on('suspend', onSuspend);
  powerMonitor.on('resume', onResume);
  powerMonitor.on('lock-screen', onLock);
  powerMonitor.on('unlock-screen', onUnlock);
  powerMonitor.on('user-did-resign-active', onResign);
  powerMonitor.on('user-did-become-active', onBecome);
  cleanup.push(() => {
    powerMonitor.off('suspend', onSuspend);
    powerMonitor.off('resume', onResume);
    powerMonitor.off('lock-screen', onLock);
    powerMonitor.off('unlock-screen', onUnlock);
    powerMonitor.off('user-did-resign-active', onResign);
    powerMonitor.off('user-did-become-active', onBecome);
  });

  cleanup.push(
    onComposerHidden(() => {
      stopRecording();
      service.composerHidden();
    }),
  );
  cleanup.push(onComposerFocused(() => service.composerFocused()));
  const composer = composerWindow();
  const onReload = () => stopRecording();
  composer?.webContents.on('did-start-loading', onReload);
  cleanup.push(() => composer?.webContents.off('did-start-loading', onReload));

  // Attached after forwardEventsToRenderers(), so a shortcut write-back reaches the renderers last.
  const onSettings = ({ key, value }: { key: string; value: unknown }) => {
    if (key === 'reminders.shortcut') onShortcutSetting(String(value));
    else service.settingsChanged(key);
  };
  bus.on('settings:changed', onSettings);
  cleanup.push(() => bus.off('settings:changed', onSettings));

  // A stored shortcut that fails now is kept, with the error shown in Settings.
  applied = settings().get('reminders.shortcut');
  applyShortcut(applied);

  service.start();
}

export const remindersModule: ServiceModule = {
  name: 'reminders',
  init(ctx) {
    logger = ctx.log;
    events = ctx.events;
    const preview = isPreviewMode(process.argv, process.env);
    const service = createRemindersService({
      store: createReminderStore(ctx.db),
      prefs,
      timeZone: () => detectTimeZone(),
      probe: {
        idleSeconds: () => powerMonitor.getSystemIdleTime(),
        locked: () => powerMonitor.getSystemIdleState(1) === 'locked',
        modal: xbotModalOpen,
        fullScreen: looksFullScreen,
        composerVisible: isComposerVisible,
      },
      outlet: {
        autoOpen: showComposerInactive,
        hideComposer,
        notificationsSupported: () => Notification.isSupported(),
        notify: (cycleId, body) => showNotification(body, (result) => instance?.notificationResult(cycleId, result), cycleId),
        closeNotification,
      },
      ideas: {
        top: () => suggestions().getTopRelevant(),
        hasNewActivitySince: (ms) => projects().hasNewActivitySince(ms),
        refresh: () => suggestions().refresh('auto', 'background'),
        aiReady: () => ai().state().phase === 'ready',
      },
      events: ctx.events,
      // Each name/payload pair is typed by RemindersEvents; the bus's generic signature can't follow it.
      emit: (status) => void (ctx.events.emit as (n: string, p: unknown) => boolean).call(ctx.events, 'reminders:changed', status),
      log: ctx.log,
      preview,
      // e2e runs drive reminders only through the test seam.
      autoSchedule: !(!app.isPackaged && process.env.XBOT_E2E === '1'),
    });
    instance = service;
  },
  dispose() {
    instance?.dispose();
    for (const undo of cleanup) undo();
    cleanup = [];
    closeNotification();
    stopRecording();
    if (registered) globalShortcut.unregisterAll();
    registered = null;
    instance = null;
    startedReminders = false;
  },
};
