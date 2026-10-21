import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useEscapeLayer } from './escapeLayers';
import { popovers, type PopoverId } from './popoverManager';
import { cx } from './Surfaces';
import { usePopoverOpen } from './usePopover';

export type Placement = 'top' | 'top-start' | 'top-end' | 'bottom' | 'bottom-start' | 'bottom-end';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Keeps floating surfaces this far inside the window. */
const VIEWPORT_MARGIN = 8;

/**
 * Where a floating surface goes relative to its anchor: flipped to the other
 * side if it would leave the window, then clamped inside it.
 */
export function placeFloating(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: Placement,
  offset: number,
  crossOffset = 0,
): { left: number; top: number } {
  const [side, align = 'center'] = placement.split('-') as ['top' | 'bottom', ('start' | 'end')?];
  const above = anchor.top - offset - size.height;
  const below = anchor.top + anchor.height + offset;
  let top = side === 'top' ? above : below;
  if (side === 'top' && above < VIEWPORT_MARGIN && below + size.height <= viewport.height - VIEWPORT_MARGIN) top = below;
  if (side === 'bottom' && below + size.height > viewport.height - VIEWPORT_MARGIN && above >= VIEWPORT_MARGIN) top = above;

  let left =
    align === 'start'
      ? anchor.left
      : align === 'end'
        ? anchor.left + anchor.width - size.width
        : anchor.left + anchor.width / 2 - size.width / 2;
  left += crossOffset;

  const clamp = (value: number, max: number) => Math.min(Math.max(value, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, max));
  return {
    left: Math.round(clamp(left, viewport.width - size.width - VIEWPORT_MARGIN)),
    top: Math.round(clamp(top, viewport.height - size.height - VIEWPORT_MARGIN)),
  };
}

/**
 * Positions the returned ref's element against `anchor` while mounted, and
 * again whenever the window or the element resizes. It writes `left`/`top`
 * straight to the element and marks it `data-placed`; CSS keeps it hidden
 * until then.
 */
export function useFloatingPosition<T extends HTMLElement>(
  anchor: RefObject<HTMLElement | null>,
  placement: Placement,
  offset: number,
  crossOffset = 0,
): RefObject<T | null> {
  const floating = useRef<T>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current;
      const f = floating.current;
      if (!a || !f) return;
      const { left, top } = placeFloating(
        a.getBoundingClientRect(),
        { width: f.offsetWidth, height: f.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        placement,
        offset,
        crossOffset,
      );
      f.style.left = `${left}px`;
      f.style.top = `${top}px`;
      f.dataset.placed = 'true';
    };
    place();
    const observer = new ResizeObserver(place);
    if (floating.current) observer.observe(floating.current);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor, placement, offset, crossOffset]);
  return floating;
}

export interface PopoverProps {
  id: PopoverId;
  /** The control that opens it; the popover is placed against this element. */
  anchor: RefObject<HTMLElement | null>;
  placement?: Placement;
  /** Gap between the anchor and the popover, px. */
  offset?: number;
  /** Shift along the anchor's edge, px (negative moves left). */
  crossOffset?: number;
  /** Accessible name. */
  label: string;
  /** Pointer-downs inside these elements do not close it (e.g. the crop overlay it controls). */
  keepOpenWithin?: readonly RefObject<HTMLElement | null>[];
  role?: 'dialog' | 'menu';
  className?: string;
  testId?: string;
  onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void;
  children: ReactNode;
}

/**
 * An anchored glass popover. It renders into document.body, positioned over
 * the page, so opening it never moves anything underneath (the Studio canvas
 * keeps its rect). Only one is open per window (`popovers`). Escape and an
 * outside click close it; focus returns to the anchor.
 */
export function Popover(props: PopoverProps) {
  const open = usePopoverOpen(props.id);
  return open ? <PopoverSurface {...props} /> : null;
}

function PopoverSurface({
  id,
  anchor,
  placement = 'bottom',
  offset = 10,
  crossOffset = 0,
  label,
  keepOpenWithin,
  role = 'dialog',
  className,
  testId,
  onKeyDown,
  children,
}: PopoverProps) {
  const surface = useFloatingPosition<HTMLDivElement>(anchor, placement, offset, crossOffset);

  useEscapeLayer(true, () => {
    popovers.close(id);
    anchor.current?.focus();
  });

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (surface.current?.contains(target) || anchor.current?.contains(target)) return;
      if (keepOpenWithin?.some((ref) => ref.current?.contains(target))) return;
      popovers.close(id);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [id, anchor, surface, keepOpenWithin]);

  useEffect(() => {
    if (role === 'dialog') surface.current?.focus({ preventScroll: true });
  }, [role, surface]);

  return createPortal(
    <div
      ref={surface}
      role={role}
      aria-label={label}
      tabIndex={-1}
      data-testid={testId}
      className={cx('popover glass-float', className)}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}
