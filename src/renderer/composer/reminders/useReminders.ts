import { useEffect, useState } from 'react';
import type { ReminderStatus, StartupStatus } from '../../../shared/contracts/reminders';

// The reminder status from main, kept current through the forwarded
// `reminders:changed` event. The last value any instance saw seeds the next
// one (the settings section, the onboarding step), so nothing flashes empty.

let lastStatus: ReminderStatus | null = null;

export function useReminders(enabled = true): ReminderStatus | null {
  const [status, setStatus] = useState<ReminderStatus | null>(() => (enabled ? lastStatus : null));
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const set = (next: ReminderStatus) => {
      lastStatus = next;
      if (alive) setStatus(next);
    };
    void window.xbot.reminders.getStatus().then((result) => {
      if (result.ok) set(result.data);
    });
    const off = window.xbot.events.on('reminders:changed', set);
    return () => {
      alive = false;
      off();
    };
  }, [enabled]);
  return status;
}

/** Launch at login and the shortcut, read when a section mounts; `set` takes a call's fresh answer. */
export function useStartup(enabled = true): { startup: StartupStatus | null; set(next: StartupStatus): void } {
  const [startup, setStartup] = useState<StartupStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void window.xbot.reminders.getStartup().then((result) => {
      if (alive && result.ok) setStartup(result.data);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return { startup, set: setStartup };
}

/** Whether this window has keyboard focus (an auto-opened composer doesn't until it is clicked). */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return focused;
}
