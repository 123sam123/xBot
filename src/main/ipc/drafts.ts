// Owned by T3 (XBOT-6F4GAC).
import { clipboard } from 'electron';
import { z } from 'zod';
import { draftsChannels } from '../../shared/contracts/drafts.channels';
import {
  attachmentRefSchema,
  draftIdSchema,
  reorderAttachmentsSchema,
  updateDraftSchema,
} from '../../shared/contracts/drafts';
import { appEvents } from '../events';
import { currentStudioTarget, drafts, setStudioTarget } from '../services/drafts';
import { draftsQueue } from '../services/drafts/queue';
import { composerWindow } from '../windows/composer';
import { openStudio } from '../windows/studio';
import { IpcError } from './core';
import { handle } from './register';

let flushAck: (() => void) | null = null;

/**
 * Asks the composer to save pending text and waits for its ack, at most
 * `timeoutMs`. Resolves at once when there is nothing to wait for: a composer
 * that is not loaded or has crashed. Preview mode saves too (T10): its drafts
 * are real rows in the preview userData.
 */
export function requestDraftFlush(timeoutMs: number): Promise<void> {
  const composer = composerWindow();
  if (!composer || composer.isDestroyed() || composer.webContents.isCrashed() || composer.webContents.isLoading()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      flushAck = null;
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    flushAck = done;
    appEvents.emit('drafts:flush-requested', {});
  });
}

export function registerDraftsIpc(): void {
  handle(draftsChannels.getCurrent, z.undefined(), () => drafts().getCurrent());
  handle(draftsChannels.update, updateDraftSchema, ({ id, text }) => drafts().update(id, text));
  handle(draftsChannels.list, z.undefined(), () => drafts().list());
  handle(draftsChannels.restore, draftIdSchema, ({ id }) => draftsQueue(() => drafts().restore(id)));
  handle(draftsChannels.delete, draftIdSchema, ({ id }) =>
    draftsQueue(() => {
      drafts().remove(id);
      return null;
    }),
  );
  handle(draftsChannels.startNew, z.undefined(), () => draftsQueue(() => drafts().startNew()));
  handle(draftsChannels.removeAttachment, attachmentRefSchema, ({ draftId, attachmentId }) =>
    draftsQueue(() => drafts().removeAttachment(draftId, attachmentId)),
  );
  handle(draftsChannels.reorderAttachments, reorderAttachmentsSchema, ({ draftId, attachmentIds }) =>
    draftsQueue(() => drafts().reorderAttachments(draftId, attachmentIds)),
  );
  handle(draftsChannels.copyText, draftIdSchema, ({ id }) => {
    const { text } = drafts().get(id);
    if (text.trim() === '') throw new IpcError('draft_empty', 'There is no text to copy.');
    clipboard.writeText(text); // write only: xBot never reads the clipboard
    return null;
  });
  handle(draftsChannels.openInStudio, attachmentRefSchema, ({ draftId, attachmentId }) => {
    const { media } = drafts().attachment(draftId, attachmentId);
    setStudioTarget({ draftId, attachmentId, media });
    openStudio();
    return null;
  });
  handle(draftsChannels.getStudioTarget, z.undefined(), () => currentStudioTarget());
  handle(draftsChannels.flushed, z.undefined(), (_payload, event) => {
    if (event.sender === composerWindow()?.webContents) flushAck?.();
    return null;
  });
}
