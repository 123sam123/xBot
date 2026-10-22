import type { ComponentPropsWithRef, MouseEvent, ReactNode } from 'react';
import { cx } from './Surfaces';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** Shown but inert. It stays focusable (aria-disabled) so a Tooltip can say why. */
  disabled?: boolean;
  /** An icon before the label. */
  icon?: ReactNode;
  /** An icon after the label, e.g. "Post ↑". */
  iconAfter?: ReactNode;
}

function BaseButton({ className, disabled, onClick, icon, iconAfter, children, type = 'button', ...rest }: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      type={type}
      className={cx('btn', className)}
      aria-disabled={disabled || undefined}
      onClick={handleClick}
      {...rest}
    >
      {icon}
      {children !== undefined && <span className="btn-label">{children}</span>}
      {iconAfter}
    </button>
  );
}

/** The frosted white pill with dark text: the primary action ("Post ↑", "Add to post"). */
export function FrostedButton({ className, ...props }: ButtonProps) {
  return <BaseButton className={cx('btn-frost', className)} {...props} />;
}

/** Text on glass, no fill until hovered ("‹ Back to post", "Fit ⌄"). */
export function GhostButton({ className, ...props }: ButtonProps) {
  return <BaseButton className={cx('btn-ghost', className)} {...props} />;
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'iconAfter'> {
  /** The accessible name; icon buttons have no visible text. */
  label: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Bare: no glass circle behind the icon. */
  bare?: boolean;
}

/** A round glass button holding one icon (✕ remove, ⊕ add, ▶ play). */
export function IconButton({ label, size = 'md', bare = false, className, children, ...props }: IconButtonProps) {
  return (
    <BaseButton
      aria-label={label}
      className={cx('btn-icon', `btn-icon-${size}`, bare && 'btn-icon-bare', className)}
      icon={children}
      {...props}
    />
  );
}
