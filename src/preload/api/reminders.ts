// Owned by T8 (XBOT-8V5WV5).
import type { RemindersApi } from '../../shared/contracts/reminders';
import { remindersChannels } from '../../shared/contracts/reminders.channels';
import { invoke } from '../invoke';

export const reminders: RemindersApi = {
  getStatus: () => invoke(remindersChannels.getStatus),
  snooze: (payload) => invoke(remindersChannels.snooze, payload),
  skipNext: () => invoke(remindersChannels.skipNext),
  resume: () => invoke(remindersChannels.resume),
  testNotification: () => invoke(remindersChannels.testNotification),
  getStartup: () => invoke(remindersChannels.getStartup),
  setLaunchAtLogin: (enabled) => invoke(remindersChannels.setLaunchAtLogin, { enabled }),
  setShortcut: (accelerator) => invoke(remindersChannels.setShortcut, { accelerator }),
  recordShortcut: (active) => invoke(remindersChannels.recordShortcut, { active }),
};
