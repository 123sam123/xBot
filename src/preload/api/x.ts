// Owned by T9 (XBOT-OE2XV9).
import type { XApi } from '../../shared/contracts/x';
import { xChannels } from '../../shared/contracts/x.channels';
import { invoke } from '../invoke';

export const x: XApi = {
  getState: () => invoke(xChannels.getState),
  connect: (reconnectAccountId) => invoke(xChannels.connect, reconnectAccountId ? { reconnectAccountId } : undefined),
  cancelConnect: () => invoke(xChannels.cancelConnect),
  switchAccount: (accountId) => invoke(xChannels.switchAccount, { accountId }),
  disconnect: (accountId) => invoke(xChannels.disconnect, { accountId }),
  post: ({ draftId, text, attachmentIds }) => invoke(xChannels.post, { draftId, text, attachmentIds: [...attachmentIds] }),
  getOpenJobs: () => invoke(xChannels.getOpenJobs),
  cancelJob: (jobId) => invoke(xChannels.cancelJob, { jobId }),
  retryJob: (jobId) => invoke(xChannels.retryJob, { jobId }),
  reconcile: (jobId) => invoke(xChannels.reconcile, { jobId }),
  markNotPosted: (jobId) => invoke(xChannels.markNotPosted, { jobId }),
  dismissJob: (jobId) => invoke(xChannels.dismissJob, { jobId }),
};
