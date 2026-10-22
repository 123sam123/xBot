// Owned by T8 (XBOT-8V5WV5).
import { z } from 'zod';
import { launchAtLoginSchema, recordShortcutSchema, shortcutSchema, snoozeSchema } from '../../shared/contracts/reminders';
import { remindersChannels } from '../../shared/contracts/reminders.channels';
import { recordShortcut, reminders, sendTestNotification, setLaunchAtLogin, setShortcut, startupStatus } from '../services/reminders';
import { handle } from './register';

export function registerRemindersIpc(): void {
  handle(remindersChannels.getStatus, z.undefined(), () => reminders().status());
  handle(remindersChannels.snooze, snoozeSchema, (payload) => reminders().snooze(payload));
  handle(remindersChannels.skipNext, z.undefined(), () => reminders().skipNext());
  handle(remindersChannels.resume, z.undefined(), () => reminders().clearSnooze());
  handle(remindersChannels.testNotification, z.undefined(), () => sendTestNotification());
  handle(remindersChannels.getStartup, z.undefined(), () => startupStatus());
  handle(remindersChannels.setLaunchAtLogin, launchAtLoginSchema, ({ enabled }) => setLaunchAtLogin(enabled));
  handle(remindersChannels.setShortcut, shortcutSchema, ({ accelerator }) => setShortcut(accelerator));
  handle(remindersChannels.recordShortcut, recordShortcutSchema, ({ active }) => {
    recordShortcut(active);
    return null;
  });
}
