import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { CheckIcon } from './icons';
import { Popover, type Placement } from './Popover';
import { popovers, type PopoverId } from './popoverManager';

export interface MenuItem {
  id: string;
  label: string;
  /** A second, quieter line, e.g. why an item is unavailable. */
  detail?: string;
  disabled?: boolean;
  checked?: boolean;
  onSelect?(): void;
}

export interface MenuProps {
  id: PopoverId;
  anchor: RefObject<HTMLElement | null>;
  label: string;
  items: readonly MenuItem[];
  placement?: Placement;
  offset?: number;
  testId?: string;
  /** Non-interactive text above the items, e.g. a status line (T8). */
  header?: ReactNode;
}

/** A Popover holding `role="menu"` items: Up/Down/Home/End move, Enter or Space activates. */
export function Menu({ id, anchor, label, items, placement = 'bottom-end', offset = 8, testId, header }: MenuProps) {
  return (
    <Popover id={id} anchor={anchor} placement={placement} offset={offset} label={label} role="menu" className="menu" testId={testId}>
      {header && <div className="menu-header">{header}</div>}
      <MenuItems id={id} items={items} />
    </Popover>
  );
}

function MenuItems({ id, items }: { id: PopoverId; items: readonly MenuItem[] }) {
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (entries.length === 0) return;
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % entries.length
        : event.key === 'ArrowUp'
          ? (index - 1 + entries.length) % entries.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? entries.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    entries[next]!.focus();
  };

  return (
    <div ref={list} className="menu-items" onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={item.checked}
          aria-disabled={item.disabled || undefined}
          tabIndex={-1}
          className="menu-item"
          onClick={() => {
            if (item.disabled) return;
            popovers.close(id);
            item.onSelect?.();
          }}
        >
          <span className="menu-item-text">
            <span className="menu-item-label">{item.label}</span>
            {item.detail && <span className="menu-item-detail">{item.detail}</span>}
          </span>
          {item.checked && <CheckIcon size={16} />}
        </button>
      ))}
    </div>
  );
}
