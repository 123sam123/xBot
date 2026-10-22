import type { Ref } from 'react';
import { AlarmIcon, cx, LightbulbIcon } from '../design-system';

/**
 * The bottom row: when the next reminder is, or the idea a reminder brought
 * (T8). Clickable once reminders run: it opens the reminder menu, so it says
 * so to assistive tech. `hint` is a quieter second line (notifications off).
 */
export function ReminderRow({
  label,
  muted = false,
  onClick,
  buttonRef,
  expanded,
  idea = false,
  hint,
}: {
  label: string;
  muted?: boolean;
  onClick?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  expanded?: boolean;
  /** The label is an idea, not a time: shown with the bulb. */
  idea?: boolean;
  hint?: string | null;
}) {
  const content = (
    <>
      {idea ? <LightbulbIcon size={21} strokeWidth={1.6} /> : <AlarmIcon size={21} strokeWidth={1.6} />}
      <span className="reminder-row-label">{label}</span>
    </>
  );
  const row = onClick ? (
    <button
      ref={buttonRef}
      type="button"
      className="reminder-row reminder-row-button"
      data-testid="reminder-row"
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className={cx('reminder-row', muted && 'reminder-row-muted')} data-testid="reminder-row">
      {content}
    </div>
  );
  if (!hint) return row;
  return (
    <>
      {row}
      <p className="reminder-row-hint" data-testid="reminder-hint">
        {hint}
      </p>
    </>
  );
}
