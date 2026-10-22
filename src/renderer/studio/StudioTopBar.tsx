import type { ReactNode } from 'react';
import { ChevronLeftIcon, FrostedButton, GhostButton, Tooltip } from '../design-system';

/** "‹ Back to post" · "Media Studio" · "Add to post". The bar also drags the frameless window. */
export function StudioTopBar({
  onBack,
  onAdd,
  addDisabledReason,
  badge,
  notice,
  actions,
  addLabel = 'Add to post',
}: {
  onBack(): void;
  onAdd(): void;
  /** Set when there is nothing to add; shown as the button's tooltip. */
  addDisabledReason?: string;
  /** A label beside the title, e.g. "Preview". */
  badge?: string;
  notice?: ReactNode;
  /** Controls before "Add to post" (undo, redo, more). */
  actions?: ReactNode;
  /** E.g. "Rendering…" while the export runs. */
  addLabel?: string;
}) {
  const add = (
    <FrostedButton className="studio-add" data-testid="studio-add" disabled={addDisabledReason !== undefined} onClick={onAdd}>
      {addLabel}
    </FrostedButton>
  );
  return (
    <header className="studio-bar">
      <GhostButton className="studio-back" icon={<ChevronLeftIcon size={26} strokeWidth={2} />} onClick={onBack}>
        Back to post
      </GhostButton>
      <h1 className="studio-title">
        Media Studio
        {badge && <span className="badge studio-badge">{badge}</span>}
      </h1>
      <span className="studio-bar-end">
        {notice}
        {actions}
        {addDisabledReason ? <Tooltip label={addDisabledReason}>{add}</Tooltip> : add}
      </span>
    </header>
  );
}
