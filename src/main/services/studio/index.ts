// Owned by T4/T5 (XBOT-1N58PP, XBOT-G66JJK). Already wired into services/index.ts (after media).
import type { StudioTarget } from '../../../shared/contracts/drafts';
import type { StudioOpened, StudioSession, StudioView } from '../../../shared/contracts/studio';
import { IpcError } from '../../ipc/core';
import { drafts } from '../drafts';
import { media } from '../media';
import { settings } from '../settings';
import type { ServiceContext, ServiceModule } from '../types';
import { createStudioService, type StudioService } from './service';

// The Studio's session: the document it shows (remembered across restarts in
// `studio.currentDocumentId`) and the attachment whose "Edit in Studio ↗"
// opened it, or a read-only video view for this run only. T3's
// `draft:studio-target` hand-off opens the attachment's document here.

type Session = { documentId: string; openedFromAttachmentId: string | null } | { view: StudioView } | null;

let instance: StudioService | null = null;
let ctx: ServiceContext | null = null;
let session: Session = null;
let offTarget: (() => void) | null = null;

export function studio(): StudioService {
  if (!instance) throw new Error('studio service used before initServices()');
  return instance;
}

/** Shows `documentId` in the Studio from now on. */
export function setStudioDocument(documentId: string, openedFromAttachmentId: string | null): void {
  session = { documentId, openedFromAttachmentId };
  settings().set('studio.currentDocumentId', documentId);
}

/** The attachment that opened `documentId`, if that document is still the one shown. */
export function openedFromAttachment(documentId: string): string | null {
  return session && 'documentId' in session && session.documentId === documentId ? session.openedFromAttachmentId : null;
}

export function currentSession(): StudioSession {
  if (session && 'view' in session) return { view: session.view };
  const id = session?.documentId ?? settings().get('studio.currentDocumentId');
  if (!id || !studio().exists(id)) return null;
  return { document: studio().get(id) };
}

function onStudioTarget(target: StudioTarget): void {
  let opened: StudioOpened;
  try {
    const result = studio().openForAttachment(target.draftId, target.attachmentId);
    if ('document' in result) setStudioDocument(result.document.id, target.attachmentId);
    else session = { view: result.view };
    opened = result;
  } catch (err) {
    // Never fail T3's open-in-studio call: the Studio shows the reason instead.
    if (!(err instanceof IpcError)) ctx?.log.error('studio: could not open the attachment', err);
    opened = { error: err instanceof IpcError ? err.message : 'The Studio couldn’t open that media.' };
  }
  ctx?.events.emit('studio:opened', opened);
}

export const studioModule: ServiceModule = {
  name: 'studio',
  init(context) {
    ctx = context;
    instance = createStudioService({ db: context.db, paths: context.paths, log: context.log, media: media(), drafts: drafts(), events: context.events });
    try {
      instance.collectGarbage(settings().get('studio.currentDocumentId'));
    } catch (err) {
      context.log.error('studio: cleanup failed', err);
    }
    context.events.on('draft:studio-target', onStudioTarget);
    offTarget = () => context.events.off('draft:studio-target', onStudioTarget);
  },
  dispose() {
    offTarget?.();
    offTarget = null;
    instance = null;
    ctx = null;
    session = null;
  },
};
