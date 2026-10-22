import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublishJob } from '../../../shared/contracts/x';
import { ArrowUpRightIcon, FrostedButton, GhostButton, Sheet, StatusChip } from '../../design-system';

type Check = { kind: 'idle' } | { kind: 'checking' } | { kind: 'missing' } | { kind: 'error'; message: string };

/**
 * "Did it post?" A create request whose answer never came may or may not have
 * posted. xBot looks for the post among the account's recent posts (once when
 * the sheet opens, then on "Check X"); only an explicit "Retry post" sends it
 * again, and "Mark as not posted" closes the job without sending anything.
 */
export function ReconcileSheet({ job, onClose }: { job: PublishJob | null; onClose(): void }) {
  return (
    <Sheet open={job !== null} title="Did it post?" onClose={onClose} testId="reconcile-sheet">
      {job && <Reconcile key={job.id} job={job} onClose={onClose} />}
    </Sheet>
  );
}

function Reconcile({ job, onClose }: { job: PublishJob; onClose(): void }) {
  const [check, setCheck] = useState<Check>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const checkedOnce = useRef(false);

  const runCheck = useCallback(async () => {
    setCheck({ kind: 'checking' });
    const result = await window.xbot.x.reconcile(job.id);
    if (!result.ok) setCheck({ kind: 'error', message: result.error.message });
    else if (!result.data.found) setCheck({ kind: 'missing' });
    else setCheck({ kind: 'idle' });
  }, [job.id]);

  // One automatic check when the sheet first shows this job; later checks are clicks.
  useEffect(() => {
    if (checkedOnce.current || job.status !== 'needs_reconciliation') return;
    checkedOnce.current = true;
    void runCheck();
  }, [job.status, runCheck]);

  useEffect(() => {
    if (job.status !== 'needs_reconciliation') onClose();
  }, [job.status, onClose]);

  const act = async (call: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setBusy(true);
    try {
      const result = await call();
      if (!result.ok && result.error) setCheck({ kind: 'error', message: result.error.message });
    } finally {
      setBusy(false);
    }
  };

  const later = job.error && job.error.code !== 'x_uncertain' ? job.error.message : null;
  return (
    <>
      <p className="sheet-lede">X didn’t confirm this post, so xBot can’t tell whether it’s on X.</p>
      <blockquote className="reconcile-post" data-testid="reconcile-text">
        {job.frozenText || <em>(media only)</em>}
        <span className="reconcile-meta">
          @{job.accountHandle}
          {job.mediaIds.length > 0 && ` · ${job.mediaIds.length === 1 ? '1 attachment' : `${job.mediaIds.length} attachments`}`}
        </span>
      </blockquote>
      <div className="reconcile-check" aria-live="polite">
        {check.kind === 'checking' && <StatusChip>Checking X…</StatusChip>}
        {check.kind === 'missing' && (
          <StatusChip tone="warning" className="publish-outcome">
            Not found on X yet. New posts can take a minute to show up; check again before retrying.
          </StatusChip>
        )}
        {check.kind === 'error' && (
          <StatusChip tone="warning" className="publish-outcome">
            {check.message}
          </StatusChip>
        )}
        {later && check.kind !== 'error' && (
          <StatusChip tone="warning" className="publish-outcome">
            {later}
          </StatusChip>
        )}
      </div>
      <div className="reconcile-actions">
        <FrostedButton disabled={check.kind === 'checking' || busy} onClick={() => void runCheck()} data-testid="reconcile-check">
          Check X
        </FrostedButton>
        <a className="btn btn-ghost" href={`https://x.com/${encodeURIComponent(job.accountHandle)}`} target="_blank" rel="noreferrer">
          <span className="btn-label">Open @{job.accountHandle}</span>
          <ArrowUpRightIcon size={16} />
        </a>
      </div>
      <div className="reconcile-actions">
        <GhostButton disabled={check.kind === 'checking' || busy} onClick={() => void act(() => window.xbot.x.retryJob(job.id))} data-testid="reconcile-retry">
          Retry post
        </GhostButton>
        <GhostButton disabled={check.kind === 'checking' || busy} onClick={() => void act(() => window.xbot.x.markNotPosted(job.id))} data-testid="reconcile-not-posted">
          Mark as not posted
        </GhostButton>
      </div>
      <p className="sheet-note">
        Retry post looks on X once more, then sends the post again. If X did get the first one and hasn’t shown it yet, that makes a duplicate.
      </p>
    </>
  );
}
