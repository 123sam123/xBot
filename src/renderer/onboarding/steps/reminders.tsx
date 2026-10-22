import { useState } from 'react';
import { useSettings } from '../../common/useSettings';
import { DaysField, IntervalField, useReminders, WorkHoursField } from '../../composer/reminders';
import { GhostButton } from '../../design-system';
import type { OnboardingStep } from '../registry';

/**
 * Onboarding step 6: choose reminder hours. Reminders start only once this
 * step is passed (or skipped), one interval later. The test notification
 * makes macOS ask for permission now rather than at the first reminder.
 */
function ReminderHours() {
  const { values } = useSettings();
  const status = useReminders();
  const [tested, setTested] = useState<string | null>(null);
  if (!values) return null;

  const test = async () => {
    const result = await window.xbot.reminders.testNotification();
    setTested(result.ok ? 'Sent. If macOS asks, allow notifications for xBot.' : result.error.message);
  };
  return (
    <>
      <p className="sheet-lede">A gentle nudge to share what you’re building, only during these hours.</p>
      <WorkHoursField start={values['reminders.workStart']} end={values['reminders.workEnd']} timeZone={status?.timeZone ?? null} />
      <DaysField days={values['reminders.days']} />
      <IntervalField minutes={values['reminders.intervalMinutes']} />
      <div className="reminder-field">
        <GhostButton onClick={() => void test()} data-testid="reminder-test-notification">
          Send a test notification
        </GhostButton>
        {tested && <p className="reminder-note">{tested}</p>}
      </div>
    </>
  );
}

const step: OnboardingStep = { id: 'reminders', order: 50, title: 'Choose reminder hours', Component: ReminderHours };
export default step;
