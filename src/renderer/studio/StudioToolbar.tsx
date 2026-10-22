import type { ReactNode, RefObject } from 'react';
import { cx, Tooltip } from '../design-system';

export interface ToolbarItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  /** The anchor its settings popover is placed against. */
  anchor: RefObject<HTMLButtonElement | null>;
}

/** The floating glass action bar under the canvas: one item per settings popover. */
export function StudioToolbar<T extends string>({
  items,
  active,
  onSelect,
  disabledReason,
}: {
  items: readonly ToolbarItem<T>[];
  /** The item whose popover is open, if any. */
  active: T | null;
  onSelect(id: T): void;
  /** Tooltip for disabled items. */
  disabledReason?: string;
}) {
  return (
    <div className="studio-toolbar glass-float" role="toolbar" aria-label="Edit media" data-testid="studio-toolbar">
      {items.map((item, index) => {
        const button = (
          <button
            ref={item.anchor}
            type="button"
            className={cx('tool', item.id === active && 'tool-active')}
            data-testid={`tool-${item.id}`}
            aria-haspopup="dialog"
            aria-expanded={item.id === active}
            aria-disabled={item.disabled || undefined}
            onClick={() => !item.disabled && onSelect(item.id)}
          >
            {item.icon}
            <span className="tool-label">{item.label}</span>
          </button>
        );
        return (
          <span key={item.id} className="tool-slot">
            {index > 0 && <span className="tool-divider" aria-hidden="true" />}
            {item.disabled && disabledReason ? <Tooltip label={disabledReason}>{button}</Tooltip> : button}
          </span>
        );
      })}
    </div>
  );
}
