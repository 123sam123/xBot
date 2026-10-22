import { useRef } from 'react';
import type { Idea } from '../../../shared/contracts/projects';
import type { ReminderStatus, SnoozePayload } from '../../../shared/contracts/reminders';
import { NOTIFICATIONS_OFF_HINT, reminderLabel } from '../../../shared/reminders/label';
import { setSetting, useSettings } from '../../common/useSettings';
import { Menu, popovers, usePopoverOpen, type MenuItem } from '../../design-system';
import { PREVIEW_REMINDER_LABEL } from '../../preview/fixtures';
import { useClock } from '../publish/usePublishJobs';
import { ReminderRow } from '../ReminderRow';
import { useReminders, useWindowFocused } from './useReminders';

export const REMINDER_MENU = 'reminders';
const IDEA_ROW_CHARS = 48;

const short = (text: string) => (text.length > IDEA_ROW_CHARS ? `${text.slice(0, IDEA_ROW_CHARS - 1).trimEnd()}…` : text);

/** Notifications matter (and are off) when reminders arrive only as notifications. */
export function notificationsHint(status: ReminderStatus | null, prefs: { autoOpen: boolean; notificationOnly: boolean }): string | null {
  if (!status?.enabled || status.notifications === 'ok') return null;
  return prefs.notificationOnly || !prefs.autoOpen ? NOTIFICATIONS_OFF_HINT : null;
}

/**
 * The composer's reminder row and its menu (T8): "Next reminder in 24 min",
 * or the idea the last reminder brought. The menu snoozes, skips, pauses and
 * opens the settings. In an auto-opened composer the idea's text, which comes
 * from project files, waits until the panel is focused (screen sharing can't
 * be detected).
 */
export function ReminderControl({
  preview,
  onUseIdea,
  onSettings,
}: {
  preview: boolean;
  /** Puts the idea's text in the draft; resolves to an error message, or null once applied. */
  onUseIdea(idea: Idea): string | null;
  onSettings(): void;
}) {
  const status = useReminders(!preview);
  const { values } = useSettings();
  const now = useClock(30_000);
  const focused = useWindowFocused();
  const anchor = useRef<HTMLButtonElement>(null);
  const open = usePopoverOpen(REMINDER_MENU);

  if (preview) return <ReminderRow label={PREVIEW_REMINDER_LABEL} />;
  if (!status || !values) return <ReminderRow label="Reminders" muted />;

  const idea = status.cycle?.idea ?? null;
  const hidden = status.cycle?.delivery === 'auto-open' && !focused;
  const timeLabel = reminderLabel(status, now);
  const label = idea ? (hidden ? 'An idea is ready' : short(idea.text)) : timeLabel;
  const hint = notificationsHint(status, { autoOpen: values['reminders.autoOpen'], notificationOnly: values['reminders.notificationOnly'] });

  const snooze = (payload: SnoozePayload) => void window.xbot.reminders.snooze(payload);
  const paused = values['reminders.paused'];
  const pausedDetail = paused ? 'Reminders are paused' : undefined;
  const items: MenuItem[] = [
    ...(idea
      ? [
          {
            id: 'use-idea',
            label: 'Use this idea',
            onSelect: () => {
              if (onUseIdea(idea) === null) void window.xbot.projects.useIdea(idea.id);
            },
          },
        ]
      : []),
    { id: 'snooze-30', label: 'Snooze 30 min', disabled: paused, detail: pausedDetail, onSelect: () => snooze({ minutes: 30 }) },
    { id: 'snooze-60', label: 'Snooze 1 hour', disabled: paused, detail: pausedDetail, onSelect: () => snooze({ minutes: 60 }) },
    { id: 'snooze-tomorrow', label: 'Snooze until tomorrow', disabled: paused, detail: pausedDetail, onSelect: () => snooze({ until: 'tomorrow' }) },
    { id: 'skip-next', label: 'Skip next', disabled: paused, detail: pausedDetail, onSelect: () => void window.xbot.reminders.skipNext() },
    ...(status.snoozedUntil ? [{ id: 'resume-now', label: 'Resume now', onSelect: () => void window.xbot.reminders.resume() }] : []),
    // A label swap, not a checked item: Menu's arrow keys move only between plain menu items.
    paused
      ? { id: 'resume', label: 'Resume reminders', onSelect: () => setSetting('reminders.paused', false) }
      : { id: 'pause', label: 'Pause reminders', onSelect: () => setSetting('reminders.paused', true) },
    { id: 'settings', label: 'Reminder settings…', onSelect: onSettings },
  ];

  return (
    <>
      <ReminderRow
        label={label}
        idea={idea !== null}
        hint={hint ? 'Notifications are off for xBot' : null}
        onClick={() => popovers.toggle(REMINDER_MENU)}
        buttonRef={anchor}
        expanded={open}
      />
      <Menu
        id={REMINDER_MENU}
        anchor={anchor}
        label="Reminders"
        placement="top-start"
        testId="reminder-menu"
        items={items}
        header={
          <>
            <span className="reminder-menu-status">{timeLabel}</span>
            {idea && <span className="reminder-menu-idea">{idea.text}</span>}
            {hint && <span className="reminder-menu-hint">{hint}</span>}
          </>
        }
      />
    </>
  );
}
