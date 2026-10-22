// Owned by T3 (XBOT-6F4GAC).
export const draftsChannels = {
  getCurrent: 'drafts:get-current',
  update: 'drafts:update',
  list: 'drafts:list',
  restore: 'drafts:restore',
  delete: 'drafts:delete',
  startNew: 'drafts:start-new',
  removeAttachment: 'drafts:remove-attachment',
  reorderAttachments: 'drafts:reorder-attachments',
  /** Writes the saved draft text to the clipboard. xBot never reads the clipboard. */
  copyText: 'drafts:copy-text',
  openInStudio: 'drafts:open-in-studio',
  getStudioTarget: 'drafts:get-studio-target',
  /** The composer's answer to `drafts:flush-requested`: its pending save has landed. */
  flushed: 'drafts:flushed',
} as const;
