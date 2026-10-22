import type { PublishJob } from '../../../shared/contracts/x';

/**
 * After a post lands, the composer starts an empty draft — but only when the
 * user is still looking at exactly what was posted. Text typed or media added
 * after Post ↑ stays where it is (the posted draft remains in history either way).
 */
export function shouldStartFreshDraft(
  job: Pick<PublishJob, 'status' | 'draftId' | 'frozenText' | 'mediaIds'>,
  current: { draftId: string; text: string; mediaIds: readonly string[] } | null,
): boolean {
  if (job.status !== 'published' || !current || job.draftId !== current.draftId) return false;
  if (current.text !== job.frozenText) return false;
  return current.mediaIds.length === job.mediaIds.length && current.mediaIds.every((id, i) => id === job.mediaIds[i]);
}
