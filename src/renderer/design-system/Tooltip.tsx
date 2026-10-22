import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPosition, type Placement } from './Popover';

const SHOW_DELAY_MS = 350;

/**
 * A short label shown on hover or keyboard focus. The text is also wired to
 * the child as its accessible description, so a disabled control can say why.
 */
export function Tooltip({
  label,
  placement = 'top',
  className,
  children,
}: {
  label: string;
  placement?: Placement;
  /** Extra classes for the wrapper, e.g. to let a full-width child stretch. */
  className?: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setVisible(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span ref={anchor} className={className ? `tooltip-anchor ${className}` : 'tooltip-anchor'} onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}>
      {cloneElement(children, { 'aria-describedby': id })}
      <span id={id} className="visually-hidden">
        {label}
      </span>
      {visible && <TooltipBubble anchor={anchor} label={label} placement={placement} />}
    </span>
  );
}

function TooltipBubble({ anchor, label, placement }: { anchor: RefObject<HTMLElement | null>; label: string; placement: Placement }) {
  const bubble = useFloatingPosition<HTMLDivElement>(anchor, placement, 8);
  return createPortal(
    <div ref={bubble} className="tooltip" aria-hidden="true">
      {label}
    </div>,
    document.body,
  );
}
