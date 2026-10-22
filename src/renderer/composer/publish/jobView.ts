import type { PublishJob } from '../../../shared/contracts/x';

// How a publish job reads in the composer: its label, tone, progress and the
// actions it offers. Pure, so it is unit-tested without React.

export type JobAction = 'cancel' | 'retry' | 'reconnect' | 'fallback' | 'dismiss' | 'check' | 'open';

export interface JobView {
  tone: 'busy' | 'ok' | 'warning' | 'neutral';
  label: string;
  /** 0–100 while a phase reports progress. */
  percent: number | null;
  /** The real post's URL, once X returned its id. */
  url: string | null;
  actions: JobAction[];
  /** Opens the "did it post?" sheet. */
  reconcile: boolean;
}

/** Errors where posting by hand is the way forward (SPEC §17's fallback). */
const FALLBACK_CODES = new Set(['x_reconnect', 'x_credits', 'x_access', 'x_rate_limited']);

export function jobView(job: PublishJob, now: number): JobView | null {
  if (job.dismissed || job.status === 'canceled') return null;
  const percent = job.progress ? Math.round(job.progress.percent) : null;
  switch (job.status) {
    case 'queued':
      return { tone: 'busy', label: 'Waiting to post…', percent: null, url: null, actions: ['cancel'], reconcile: false };
    case 'uploading':
      return { tone: 'busy', label: `Uploading${percent !== null ? ` ${percent}%` : '…'}`, percent, url: null, actions: ['cancel'], reconcile: false };
    case 'processing':
      return { tone: 'busy', label: `X is processing the media${percent !== null ? ` ${percent}%` : '…'}`, percent, url: null, actions: ['cancel'], reconcile: false };
    case 'publishing':
      return { tone: 'busy', label: 'Posting to X…', percent: null, url: null, actions: [], reconcile: false };
    case 'published':
      return { tone: 'ok', label: `Posted to X as @${job.accountHandle}`, percent: null, url: job.remoteUrl, actions: ['open', 'dismiss'], reconcile: false };
    case 'needs_reconciliation':
      return { tone: 'warning', label: job.error?.code && job.error.code !== 'x_uncertain' ? job.error.message : 'X didn’t confirm this post.', percent: null, url: null, actions: ['check'], reconcile: true };
    case 'failed': {
      const code = job.error?.code ?? '';
      const actions: JobAction[] = [];
      if (code === 'x_reconnect') actions.push('reconnect');
      const waiting = job.error?.resetAt ? Date.parse(job.error.resetAt) > now : false;
      if (!['x_reconnect', 'x_credits', 'x_access', 'x_duplicate', 'x_media_rejected'].includes(code) && !waiting) actions.push('retry');
      if (FALLBACK_CODES.has(code)) actions.push('fallback');
      actions.push('dismiss');
      return { tone: 'warning', label: job.error?.message ?? 'The post failed.', percent: null, url: null, actions, reconcile: false };
    }
  }
}

/** The job the composer shows: the current draft's, else the newest open one of any draft. */
export function pickJob(jobs: readonly PublishJob[], currentDraftId: string | null, now: number): PublishJob | null {
  const visible = jobs.filter((j) => jobView(j, now) !== null);
  const newestFirst = [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return newestFirst.find((j) => currentDraftId !== null && j.draftId === currentDraftId) ?? newestFirst[0] ?? null;
}
