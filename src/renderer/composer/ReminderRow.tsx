import { AlarmIcon, cx } from '../design-system';

/** The bottom row: when the next reminder is. Clickable once reminders exist (T8). */
export function ReminderRow({ label, muted = false, onClick }: { label: string; muted?: boolean; onClick?: () => void }) {
  const content = (
    <>
      <AlarmIcon size={21} strokeWidth={1.6} />
      <span>{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="reminder-row reminder-row-button" data-testid="reminder-row" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={cx('reminder-row', muted && 'reminder-row-muted')} data-testid="reminder-row">
      {content}
    </div>
  );
}
