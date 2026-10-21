import { GhostButton, SparkleIcon } from '../../design-system';

export type AiStatus =
  | { kind: 'running'; model: string | null; onCancel(): void }
  | { kind: 'ready'; label: string; onView(): void }
  | { kind: 'undo'; onUndo(): void }
  | { kind: 'error'; message: string; onRetry?: () => void; onSetup?: () => void };

/**
 * One quiet row above the action row, shown only while it has something to
 * say: a local run in progress (with Cancel), suggestions that finished
 * while the sheet was closed, an AI change that can be undone, or a failure.
 * The editor stays editable throughout.
 */
export function AiStatusRow({ status }: { status: AiStatus | null }) {
  if (!status) return null;
  return (
    <div className="ai-status-row" data-testid="ai-status-row" data-kind={status.kind} role={status.kind === 'error' ? 'alert' : 'status'}>
      {status.kind === 'running' && (
        <>
          <SparkleIcon size={16} className="ai-status-icon ai-status-busy" />
          <span className="ai-status-text">
            Running locally{status.model ? <span className="ai-status-model"> · {status.model}</span> : null}
          </span>
          <GhostButton className="ai-status-action" onClick={status.onCancel}>
            Cancel
          </GhostButton>
        </>
      )}
      {status.kind === 'ready' && (
        <>
          <SparkleIcon size={16} className="ai-status-icon" />
          <span className="ai-status-text">{status.label}</span>
          <GhostButton className="ai-status-action" onClick={status.onView}>
            View
          </GhostButton>
        </>
      )}
      {status.kind === 'undo' && (
        <>
          <SparkleIcon size={16} className="ai-status-icon" />
          <span className="ai-status-text">AI change applied</span>
          <GhostButton className="ai-status-action" data-testid="ai-undo" onClick={status.onUndo}>
            Undo AI change
          </GhostButton>
        </>
      )}
      {status.kind === 'error' && (
        <>
          <span className="ai-status-text ai-status-error">{status.message}</span>
          {status.onRetry && (
            <GhostButton className="ai-status-action" onClick={status.onRetry}>
              Try again
            </GhostButton>
          )}
          {status.onSetup && (
            <GhostButton className="ai-status-action" onClick={status.onSetup}>
              Set up…
            </GhostButton>
          )}
        </>
      )}
    </div>
  );
}
