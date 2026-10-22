import { useId } from 'react';
import { parseClock } from '../../../shared/reminders/schedule';
import { setSetting } from '../../common/useSettings';
import { cx, NumberField } from '../../design-system';

// The reminder-hours fields, shared by Settings → Reminders and onboarding's
// "Choose reminder hours". Each writes its own setting as it changes.

const DAYS = [
  { day: 1, short: 'M', name: 'Monday' },
  { day: 2, short: 'T', name: 'Tuesday' },
  { day: 3, short: 'W', name: 'Wednesday' },
  { day: 4, short: 'T', name: 'Thursday' },
  { day: 5, short: 'F', name: 'Friday' },
  { day: 6, short: 'S', name: 'Saturday' },
  { day: 7, short: 'S', name: 'Sunday' },
] as const;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function TimeField({ label, value, onChange, testId }: { label: string; value: string; onChange(value: string): void; testId: string }) {
  return (
    <label className="field reminder-time">
      <span className="field-label">{label}</span>
      <input
        type="time"
        className="field-input"
        value={value}
        step={300}
        required
        data-testid={testId}
        // A partly typed time reads as ''; only whole times are saved.
        onChange={(event) => CLOCK.test(event.target.value) && onChange(event.target.value)}
      />
    </label>
  );
}

/** Working hours, in the zone main detected. */
export function WorkHoursField({ start, end, timeZone }: { start: string; end: string; timeZone: string | null }) {
  const span = parseClock(end) === parseClock(start) ? 'All day.' : parseClock(end) < parseClock(start) ? 'Ends the next day.' : null;
  return (
    <div className="reminder-field">
      <div className="reminder-hours">
        <TimeField label="From" value={start} onChange={(value) => setSetting('reminders.workStart', value)} testId="reminder-start" />
        <TimeField label="to" value={end} onChange={(value) => setSetting('reminders.workEnd', value)} testId="reminder-end" />
      </div>
      <p className="reminder-note">
        {[span, timeZone ? `Times are in ${timeZone.replace(/_/g, ' ')} (your Mac’s time zone).` : null].filter(Boolean).join(' ')}
      </p>
    </div>
  );
}

export function DaysField({ days }: { days: readonly number[] }) {
  const labelId = useId();
  const toggle = (day: number) =>
    setSetting(
      'reminders.days',
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b),
    );
  return (
    <div className="reminder-field">
      <span id={labelId} className="field-label">
        Days
      </span>
      <div className="reminder-days" role="group" aria-labelledby={labelId}>
        {DAYS.map(({ day, short, name }) => (
          <button
            key={day}
            type="button"
            className={cx('reminder-day', days.includes(day) && 'reminder-day-on')}
            aria-pressed={days.includes(day)}
            aria-label={name}
            title={name}
            data-testid={`reminder-day-${day}`}
            onClick={() => toggle(day)}
          >
            {short}
          </button>
        ))}
      </div>
      {days.length === 0 && <p className="reminder-note">No days chosen: reminders won’t come.</p>}
    </div>
  );
}

export function IntervalField({ minutes }: { minutes: number }) {
  return (
    <NumberField
      label="Remind me every"
      value={minutes}
      min={5}
      max={240}
      suffix="min"
      testId="reminder-interval"
      onChange={(value) => setSetting('reminders.intervalMinutes', value)}
    />
  );
}

export function DailyCapField({ cap }: { cap: number }) {
  return (
    <NumberField
      label="At most"
      value={cap}
      min={1}
      max={48}
      suffix="a day"
      testId="reminder-cap"
      onChange={(value) => setSetting('reminders.dailyCap', value)}
    />
  );
}
