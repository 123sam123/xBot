import { useEffect, useState } from 'react';
import type { DraftSummary } from '../../shared/contracts/drafts';
import { CloseIcon, IconButton, Sheet, StatusChip } from '../design-system';

function ago(iso: string, now: number): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Earlier drafts: click one to continue it, ✕ to delete it. */
export function HistorySheet({ open, onClose, onRestore }: { open: boolean; onClose(): void; onRestore(id: string): void }) {
  return (
    <Sheet open={open} title="Drafts" onClose={onClose} testId="history-sheet">
      <HistoryList onRestore={onRestore} />
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so every opening loads a fresh list. */
function HistoryList({ onRestore }: { onRestore(id: string): void }) {
  const [loaded, setLoaded] = useState<{ drafts: DraftSummary[]; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.xbot.drafts.list().then((result) => {
      if (!alive) return;
      if (result.ok) setLoaded({ drafts: result.data, at: Date.now() });
      else setError(result.error.message);
    });
    return () => {
      alive = false;
    };
  }, []);

  const remove = async (id: string) => {
    const result = await window.xbot.drafts.delete(id);
    if (result.ok) setLoaded((list) => list && { ...list, drafts: list.drafts.filter((d) => d.id !== id) });
    else setError(result.error.message);
  };

  return (
    <>
      {error && <StatusChip tone="warning">{error}</StatusChip>}
      {loaded && loaded.drafts.length === 0 && <p className="sheet-empty">No earlier drafts. “New draft” keeps the one you’re writing here.</p>}
      {loaded && loaded.drafts.length > 0 && (
        <ul className="history-list" aria-label="Earlier drafts">
          {loaded.drafts.map((d) => (
            <li key={d.id} className="history-row" data-testid="history-row">
              <button type="button" className="history-item" onClick={() => onRestore(d.id)}>
                <span className="history-thumb" aria-hidden="true">
                  {d.thumbUrl && <img src={d.thumbUrl} alt="" draggable={false} />}
                </span>
                <span className="history-text">
                  <span className="history-preview">{d.preview || 'Media only'}</span>
                  <span className="history-meta">
                    {ago(d.updatedAt, loaded.at)}
                    {d.mediaCount > 0 && ` · ${d.mediaCount === 1 ? '1 file' : `${d.mediaCount} files`}`}
                  </span>
                </span>
              </button>
              <IconButton label={`Delete draft “${d.preview || 'Media only'}”`} size="sm" bare onClick={() => void remove(d.id)}>
                <CloseIcon size={14} strokeWidth={2} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
