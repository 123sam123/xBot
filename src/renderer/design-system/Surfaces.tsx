import type { ComponentPropsWithRef, ReactNode } from 'react';

function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export { cx };

/** The window's glass shell: material, rim, highlights and scrim. */
export function GlassPanel({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div className={cx('glass-panel', className)} {...props} />;
}

/** Lighter inner glass for text-bearing cards (editor, attachments, timeline). */
export function GlassCard({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div className={cx('glass-card', className)} {...props} />;
}

export function Divider({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  return vertical ? (
    <span className={cx('divider divider-vertical', className)} role="separator" aria-orientation="vertical" />
  ) : (
    <hr className={cx('divider', className)} />
  );
}

/** A small inline status pill, e.g. "Posting is off in preview". */
export function StatusChip({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'warning';
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx('status-chip', tone === 'warning' && 'status-chip-warning', className)} role="status">
      {children}
    </span>
  );
}
