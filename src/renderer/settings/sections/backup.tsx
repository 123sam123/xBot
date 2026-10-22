import { useState } from 'react';
import type { BackupResult } from '../../../shared/contracts/backup';
import { useAppInfo } from '../../common/useAppInfo';
import { FrostedButton, GhostButton, StatusChip } from '../../design-system';
import type { SettingsSection } from '../registry';

type BackupState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; result: BackupResult } | { kind: 'error'; message: string };

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function summary({ folderName, mediaFiles, bytes, missing }: BackupResult): string {
  const files = mediaFiles === 0 ? 'no media yet' : `${mediaFiles === 1 ? '1 media file' : `${mediaFiles} media files`} (${size(bytes)})`;
  return `Saved “${folderName}”: your data and ${files}${missing > 0 ? `. ${missing} missing file${missing === 1 ? ' was' : 's were'} skipped` : ''}.`;
}

/** Settings → Data (T10): a timestamped backup of the database and media, in a folder the user picks. */
function Data() {
  const { info } = useAppInfo();
  const [state, setState] = useState<BackupState>({ kind: 'idle' });
  const busy = state.kind === 'busy';

  const backUp = async () => {
    if (busy) return;
    setState({ kind: 'busy' });
    const result = await window.xbot.backup.create();
    if (!result.ok) setState({ kind: 'error', message: result.error.message });
    else setState(result.data ? { kind: 'done', result: result.data } : { kind: 'idle' });
  };
  const reveal = async () => {
    const result = await window.xbot.backup.reveal();
    if (!result.ok) setState({ kind: 'error', message: result.error.message });
  };

  return (
    <div className="backup" data-testid="backup">
      <p className="sheet-note">
        Copies your drafts, media, Studio documents and presets, ideas, voice and settings into a new folder. X sign-in is left out:
        reconnect X after a restore. RESTORE.txt in the folder says how to restore it.
      </p>
      <div className="backup-actions">
        <FrostedButton disabled={busy} aria-busy={busy || undefined} onClick={() => void backUp()} data-testid="backup-create">
          {busy ? 'Backing up…' : 'Back up data…'}
        </FrostedButton>
        {state.kind === 'done' && (
          <GhostButton onClick={() => void reveal()} data-testid="backup-reveal">
            {info?.platform === 'darwin' ? 'Show in Finder' : 'Show in folder'}
          </GhostButton>
        )}
      </div>
      {state.kind === 'done' && (
        <StatusChip className="publish-outcome">
          {summary(state.result)}
        </StatusChip>
      )}
      {state.kind === 'error' && (
        <StatusChip tone="warning" className="publish-outcome">
          {state.message}
        </StatusChip>
      )}
    </div>
  );
}

const section: SettingsSection = { id: 'data', order: 95, title: 'Data', Component: Data };
export default section;
