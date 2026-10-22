import { PlusIcon, RecordIcon, Tooltip, cx } from '../design-system';

/**
 * The dashed "Add screenshots or video" area, and beside it Record (a screen
 * recording that opens in the Studio). Without `onAdd` the zone is shown but
 * inert, and its tooltip gives `disabledReason`. While files are dragged over
 * the window it reads "Drop to add".
 */
export function UploadZone({
  onAdd,
  onRecord,
  disabledReason,
  dragActive = false,
  busy = false,
}: {
  onAdd?: () => void;
  onRecord?: () => void;
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
  const add =
    !onAdd && disabledReason ? (
      <Tooltip label={disabledReason} className="tooltip-anchor-block">
        {zone}
      </Tooltip>
    ) : (
      zone
    );
  return (
    <div className="upload-row">
      {add}
      {onRecord && (
        <button type="button" className="record-tile" onClick={onRecord} data-testid="record-tile">
          <span className="record-tile-icon" aria-hidden="true">
            <RecordIcon size={20} />
          </span>
          <span className="upload-zone-label">Record</span>
        </button>
      )}
    </div>
  );
}
