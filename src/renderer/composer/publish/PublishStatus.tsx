import type { CSSProperties } from 'react';
import type { PublishJob } from '../../../shared/contracts/x';
import { ArrowUpRightIcon, CloseIcon, cx, GhostButton, IconButton } from '../../design-system';
import { jobView, type JobAction } from './jobView';

/**
 * The publish job's row above the action row: upload and processing progress,
 * "Posting to X…", the real post link once X answered, or what went wrong with
 * the action that fixes it. Nothing is shown when there is no job.
 */
export function PublishStatus({
  job,
  now,
  draftLabel,
  onAction,
}: {
  job: PublishJob | null;
  now: number;
  /** Names the draft when the job is not the one being edited. */
  draftLabel?: string | null;
  onAction(action: JobAction, job: PublishJob): void;
}) {
  const view = job ? jobView(job, now) : null;
  if (!job || !view) return null;
  const button = (action: JobAction, label: string) => (
    <GhostButton key={action} className="publish-status-action" onClick={() => onAction(action, job)}>
      {label}
    </GhostButton>
  );
  return (
    <div className={cx('publish-status', `publish-status-${view.tone}`)} role="status" aria-live="polite" data-testid="publish-status" data-status={job.status}>
      <div className="publish-status-text">
        <span className="publish-status-label">
          {view.tone === 'busy' && <span className="status-dot status-dot-busy" aria-hidden="true" />}
          {view.tone === 'ok' && <span className="status-dot status-dot-ok" aria-hidden="true" />}
          {view.label}
        </span>
        {draftLabel && <span className="publish-status-draft">{draftLabel}</span>}
        {view.percent !== null && (
          <span className="publish-status-bar" aria-hidden="true">
            <span style={{ '--progress': `${view.percent}%` } as CSSProperties} />
          </span>
        )}
      </div>
      <div className="publish-status-actions">
        {view.url && (
          <a className="btn btn-ghost publish-status-action" href={view.url} target="_blank" rel="noreferrer" data-testid="publish-status-link">
            <span className="btn-label">View on X</span>
            <ArrowUpRightIcon size={16} />
          </a>
        )}
        {view.actions.includes('check') && button('check', 'Check X…')}
        {view.actions.includes('reconnect') && button('reconnect', 'Reconnect')}
        {view.actions.includes('retry') && button('retry', 'Try again')}
        {view.actions.includes('fallback') && button('fallback', 'Post it yourself')}
        {view.actions.includes('cancel') && button('cancel', 'Cancel')}
        {view.actions.includes('dismiss') && (
          <IconButton label="Dismiss" size="sm" bare onClick={() => onAction('dismiss', job)}>
            <CloseIcon size={14} />
          </IconButton>
        )}
      </div>
    </div>
  );
}
