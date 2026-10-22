// Owned by T8 (XBOT-8V5WV5). Reminders, launch at login and the global shortcut.
export const remindersChannels = {
  getStatus: 'reminders:get-status',
  /** `{ minutes }` or `{ until: 'tomorrow' }`. */
  snooze: 'reminders:snooze',
  skipNext: 'reminders:skip-next',
  /** Clears a snooze; the interval restarts now. */
  resume: 'reminders:resume',
  /** Sends a sample notification, so macOS asks for permission during onboarding. */
  testNotification: 'reminders:test-notification',
  getStartup: 'reminders:get-startup',
  setLaunchAtLogin: 'reminders:set-launch-at-login',
  /** Registers the shortcut first; saved only when that worked. */
  setShortcut: 'reminders:set-shortcut',
  /** Suspends global shortcut handling while the settings field records one. */
  recordShortcut: 'reminders:record-shortcut',
} as const;
