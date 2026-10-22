import { PlusIcon, Tooltip, cx } from '../design-system';

/**
 * The dashed "Add screenshots or video" area. Without `onAdd` it is shown but
 * inert, and its tooltip gives `disabledReason`. While files are dragged over
 * the window it reads "Drop to add".
 */
export function UploadZone({
  onAdd,
  disabledReason,
  dragActive = false,
  busy = false,
}: {
  onAdd?: () => void;
  disabledReason?: string;
  dragActive?: boolean;
  /** An import is running. */
  busy?: boolean;
}) {
  const zone = (
    <button
      type="button"
      className={cx('upload-zone', dragActive && 'upload-zone-active')}
      data-testid="upload-zone"
      aria-disabled={!onAdd || undefined}
      aria-busy={busy || undefined}
      onClick={onAdd}
    >
      <span className="upload-zone-plus" aria-hidden="true">
        <PlusIcon size={18} strokeWidth={2} />
      </span>
      <span className="upload-zone-label">{dragActive ? 'Drop to add' : busy ? 'Adding…' : 'Add screenshots or video'}</span>
    </button>
  );
  return !onAdd && disabledReason ? (
    <Tooltip label={disabledReason} className="tooltip-anchor-block">
      {zone}
    </Tooltip>
  ) : (
    zone
  );
}
