import { untilPhrase } from '../../../shared/reminders/label';
import { useAppInfo } from '../../common/useAppInfo';
import { setSetting, useSettings } from '../../common/useSettings';
import { useClock } from '../../composer/publish/usePublishJobs';
import { DailyCapField, DaysField, IntervalField, notificationsHint, useReminders, WorkHoursField } from '../../composer/reminders';
import { GhostButton, Toggle } from '../../design-system';
import type { SettingsSection } from '../registry';

/** Settings → Reminders (T8): when, how often, and how a reminder arrives. Hidden in preview. */
function Reminders() {
  const { info } = useAppInfo();
  const { values } = useSettings();
  const preview = info?.isPreview ?? false;
  const status = useReminders(!preview);
  const now = useClock(30_000);
  if (!info || preview || !values) return null;

  const notificationOnly = values['reminders.notificationOnly'];
  const hint = notificationsHint(status, { autoOpen: values['reminders.autoOpen'], notificationOnly });
  const snoozedUntil = status?.snoozedUntil ? Date.parse(status.snoozedUntil) : null;
  return (
    <>
      <Toggle
        label="Pause reminders"
        description="Also in the menu-bar icon’s menu."
        checked={values['reminders.paused']}
        onChange={(value) => setSetting('reminders.paused', value)}
      />
      {snoozedUntil !== null && status && (
        <div className="toggle-row">
          <span className="toggle-text">
            <span className="toggle-label">Snoozed until {untilPhrase(snoozedUntil, now, status.timeZone)}</span>
          </span>
          <GhostButton className="ai-status-action" onClick={() => void window.xbot.reminders.resume()}>
            Resume now
          </GhostButton>
        </div>
      )}
      <IntervalField minutes={values['reminders.intervalMinutes']} />
      <WorkHoursField start={values['reminders.workStart']} end={values['reminders.workEnd']} timeZone={status?.timeZone ?? null} />
      <DaysField days={values['reminders.days']} />
      <DailyCapField cap={values['reminders.dailyCap']} />
      <Toggle
        label="Open dropdown on reminder"
        description={
          notificationOnly
            ? 'Off in notification-only mode.'
            : 'Write Post opens under the menu-bar icon without taking your keyboard. Off: a notification instead.'
        }
        checked={values['reminders.autoOpen'] && !notificationOnly}
        disabled={notificationOnly}
        onChange={(value) => setSetting('reminders.autoOpen', value)}
      />
      <Toggle
        label="Notification-only mode"
        description="Reminders only ever arrive as notifications; xBot never opens on its own."
        checked={notificationOnly}
        onChange={(value) => setSetting('reminders.notificationOnly', value)}
      />
      {hint && (
        <p className="reminder-note reminder-note-error" role="status">
          {hint}
        </p>
      )}
    </>
  );
}

const section: SettingsSection = { id: 'reminders', order: 30, title: 'Reminders', Component: Reminders };
export default section;
