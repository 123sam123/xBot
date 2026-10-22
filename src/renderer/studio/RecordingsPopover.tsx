import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { RecordingSummary } from '../../shared/contracts/recordings';
import { CameraIcon, FolderIcon, IconButton, Popover, RecordIcon, TrashIcon, usePopoverOpen } from '../design-system';
import { formatClock } from './timeline/Timeline';

export const RECORDINGS_POPOVER = 'studio-recordings';

const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Cap's "Clips": every saved recording, newest first; open one, show it in Finder, or delete it. */
export function RecordingsPopover({
  anchor,
  currentDocumentId,
  onDeletedCurrent,
  onError,
}: {
  anchor: RefObject<HTMLElement | null>;
  currentDocumentId: string | null;
  /** The open document was the deleted recording's. */
  onDeletedCurrent(): void;
  onError(message: string): void;
}) {
  const open = usePopoverOpen(RECORDINGS_POPOVER);
  const [items, setItems] = useState<RecordingSummary[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await window.xbot.recordings.list();
    if (result.ok) setItems(result.data);
    else onError(result.error.message);
  }, [onError]);

  useEffect(() => {
    if (open) void Promise.resolve().then(refresh);
  }, [open, refresh]);

  const remove = async (item: RecordingSummary) => {
    if (confirming !== item.id) return setConfirming(item.id);
    setConfirming(null);
    const result = await window.xbot.recordings.remove(item.id);
    if (!result.ok) return onError(result.error.message);
    if (item.documentId && item.documentId === currentDocumentId) onDeletedCurrent();
    await refresh();
  };

  return (
    <Popover id={RECORDINGS_POPOVER} anchor={anchor} label="Recordings" placement="bottom-end" offset={10} className="recordings-popover" testId="recordings-popover">
      <header className="recordings-head">
        <h2>Recordings</h2>
        <button type="button" className="recordings-new" onClick={() => void window.xbot.recordings.openPanel()} data-testid="recordings-new">
          <RecordIcon size={16} />
          New recording
        </button>
      </header>
      {items === null ? (
        <p className="recordings-empty">Loading…</p>
      ) : items.length === 0 ? (
        <p className="recordings-empty">No recordings yet. Record your screen with New recording, or Record in Write Post.</p>
      ) : (
        <ul className="recordings-list">
          {items.map((item) => (
            <li key={item.id} className={`recordings-row${item.documentId === currentDocumentId ? ' recordings-row-current' : ''}`}>
              <button type="button" className="recordings-open" disabled={!item.documentId} onClick={() => void window.xbot.recordings.open(item.id)} data-testid="recordings-open">
                <span className="recordings-thumb" style={item.thumbUrl ? { backgroundImage: `url("${item.thumbUrl}")` } : undefined}>
                  <span className="recordings-duration">{formatClock(item.durationMs)}</span>
                </span>
                <span className="recordings-text">
                  <span className="recordings-name">{item.name}</span>
                  <span className="recordings-meta">
                    {day.format(new Date(item.createdAt))}
                    {item.camera && <CameraIcon size={13} />}
                  </span>
                </span>
              </button>
              <IconButton label="Show in Finder" size="sm" bare onClick={() => void window.xbot.recordings.reveal(item.id)}>
                <FolderIcon size={17} />
              </IconButton>
              <IconButton
                label={confirming === item.id ? 'Click again to delete' : 'Delete recording'}
                size="sm"
                bare
                className={confirming === item.id ? 'recordings-confirm' : undefined}
                onClick={() => void remove(item)}
                data-testid="recordings-delete"
              >
                <TrashIcon size={17} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
