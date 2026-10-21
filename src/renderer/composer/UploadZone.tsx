import { PlusIcon, Tooltip } from '../design-system';

/**
 * The dashed "Add screenshots or video" area. Without `onAdd` it is shown but
 * inert, and its tooltip gives `disabledReason`.
 */
export function UploadZone({ onAdd, disabledReason }: { onAdd?: () => void; disabledReason?: string }) {
  const zone = (
    <button type="button" className="upload-zone" data-testid="upload-zone" aria-disabled={!onAdd || undefined} onClick={onAdd}>
      <span className="upload-zone-plus" aria-hidden="true">
        <PlusIcon size={18} strokeWidth={2} />
      </span>
      <span className="upload-zone-label">Add screenshots or video</span>
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
