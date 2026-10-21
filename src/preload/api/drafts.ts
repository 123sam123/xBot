// Owned by T3 (XBOT-6F4GAC).
import type { DraftsApi } from '../../shared/contracts/drafts';
import { draftsChannels } from '../../shared/contracts/drafts.channels';
import { invoke } from '../invoke';

export const drafts: DraftsApi = {
  getCurrent: () => invoke(draftsChannels.getCurrent),
  update: (id, text) => invoke(draftsChannels.update, { id, text }),
  list: () => invoke(draftsChannels.list),
  restore: (id) => invoke(draftsChannels.restore, { id }),
  delete: (id) => invoke(draftsChannels.delete, { id }),
  startNew: () => invoke(draftsChannels.startNew),
  removeAttachment: (draftId, attachmentId) => invoke(draftsChannels.removeAttachment, { draftId, attachmentId }),
  reorderAttachments: (draftId, attachmentIds) => invoke(draftsChannels.reorderAttachments, { draftId, attachmentIds: [...attachmentIds] }),
  copyText: (id) => invoke(draftsChannels.copyText, { id }),
  openInStudio: (draftId, attachmentId) => invoke(draftsChannels.openInStudio, { draftId, attachmentId }),
  getStudioTarget: () => invoke(draftsChannels.getStudioTarget),
  flushed: () => invoke(draftsChannels.flushed),
};
