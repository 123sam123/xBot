// Owned by T4/T5 (XBOT-1N58PP, XBOT-G66JJK). Already wired into services/index.ts (after media).
import { app } from 'electron';
import type { StudioTarget } from '../../../shared/contracts/drafts';
import type { StudioOpened, StudioSession, StudioView } from '../../../shared/contracts/studio';
import { IpcError } from '../../ipc/core';
import { registerStatusProvider } from '../../status';
import { drafts } from '../drafts';
import { draftsQueue } from '../drafts/queue';
import { ffmpeg } from '../ffmpeg';
import { media } from '../media';
import { settings } from '../settings';
import type { ServiceContext, ServiceModule } from '../types';
import { createStudioService, type Opened, type StudioService } from './service';

// The Studio's session: the document it shows (remembered across restarts in
// `studio.currentDocumentId`) and the attachment whose "Edit in Studio ↗"
// opened it, or a read-only video view (FFmpeg missing) for this run only.
// T3's `draft:studio-target` hand-off opens the attachment's document here;
// opening a video probes it first, so opens are numbered and a slow one that
// a newer open overtook is dropped.

type Session = { documentId: string; openedFromAttachmentId: string | null } | { view: StudioView } | null;

let instance: StudioService | null = null;
let ctx: ServiceContext | null = null;
let session: Session = null;
let opens = 0;
let offTarget: (() => void) | null = null;
let offFfmpeg: (() => void) | null = null;
let unregisterStatus: (() => void) | null = null;

export function studio(): StudioService {
  if (!instance) throw new Error('studio service used before initServices()');
  return instance;
}

/** Shows `documentId` in the Studio from now on. */
export function setStudioDocument(documentId: string, openedFromAttachmentId: string | null): void {
  session = { documentId, openedFromAttachmentId };
  settings().set('studio.currentDocumentId', documentId);
}

/** Shows `view` read-only until FFmpeg turns up or another document opens. */
export function setStudioView(view: StudioView): void {
  session = { view };
}

/** Makes `opened` the session; returns it for the caller to hand to the page. */
export function adoptOpened(opened: Opened, openedFromAttachmentId: string | null): Opened {
  if ('document' in opened) setStudioDocument(opened.document.id, openedFromAttachmentId);
  else setStudioView(opened.view);
  return opened;
}

/** A number for an open that is about to start; `isLatestOpen` says whether it is still the newest. */
export function beginOpen(): number {
  return ++opens;
}

export function isLatestOpen(ticket: number): boolean {
  return ticket === opens;
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

function failure(err: unknown, what: string): StudioOpened {
  if (!(err instanceof IpcError)) ctx?.log.error(`studio: could not open ${what}`, err);
  return { error: err instanceof IpcError ? err.message : 'The Studio couldn’t open that media.' };
}

async function onStudioTarget(target: StudioTarget): Promise<void> {
  const ticket = beginOpen();
  let opened: StudioOpened;
  try {
    const result = await studio().openForAttachment(target.draftId, target.attachmentId);
    if (!isLatestOpen(ticket)) return;
    opened = adoptOpened(result, target.attachmentId);
  } catch (err) {
    // Never fail T3's open-in-studio call: the Studio shows the reason instead.
    if (!isLatestOpen(ticket)) return;
    opened = failure(err, 'the attachment');
  }
  ctx?.events.emit('studio:opened', opened);
}

/** FFmpeg turned up: a read-only video view becomes a document. */
export async function reopenView(): Promise<void> {
  if (!session || !('view' in session) || ffmpeg().status().state !== 'ready') return;
  const { view } = session;
  const ticket = beginOpen();
  let opened: StudioOpened;
  try {
    const result =
      view.draftId && view.attachmentId ? await studio().openForAttachment(view.draftId, view.attachmentId) : await studio().openForMedia(view.media);
    if (!isLatestOpen(ticket)) return;
    opened = adoptOpened(result, view.attachmentId);
  } catch (err) {
    if (!isLatestOpen(ticket)) return;
    opened = failure(err, 'the video');
  }
  ctx?.events.emit('studio:opened', opened);
}

export const studioModule: ServiceModule = {
  name: 'studio',
  async init(context) {
    ctx = context;
    instance = createStudioService({
      db: context.db,
      paths: context.paths,
      log: context.log,
      media: media(),
      drafts: drafts(),
      events: context.events,
      video: { binaries: () => ffmpeg().binaries() },
      serialize: draftsQueue,
      // Test seam: e2e runs make an export take as long as its clip. Unpackaged builds only.
      realtime: !app.isPackaged && process.env.XBOT_E2E_FFMPEG_REALTIME === '1',
    });
    try {
      await instance.init(settings().get('studio.currentDocumentId'));
    } catch (err) {
      context.log.error('studio: cleanup failed', err);
    }
    const onTarget = (target: StudioTarget) => void onStudioTarget(target).catch((err: unknown) => context.log.error('studio: open failed', err));
    context.events.on('draft:studio-target', onTarget);
    offTarget = () => context.events.off('draft:studio-target', onTarget);
    const onFfmpeg = () => void reopenView().catch((err: unknown) => context.log.error('studio: reopen failed', err));
    context.events.on('studio:ffmpeg', onFfmpeg);
    offFfmpeg = () => context.events.off('studio:ffmpeg', onFfmpeg);
    unregisterStatus = registerStatusProvider({
      id: 'studio-export',
      order: 91,
      get: () => {
        const activity = instance?.exportActivity();
        if (!activity || (!activity.running && activity.queued === 0)) return null;
        const detail = activity.running ? `Video · ${Math.round(activity.running.progress * 100)}%` : 'Video · queued';
        return { id: 'studio-export', label: 'Export running', tone: 'busy', detail };
      },
    });
  },
  dispose() {
    offTarget?.();
    offFfmpeg?.();
    unregisterStatus?.();
    // Kills a running FFmpeg and records the job before the database closes.
    instance?.dispose();
    offTarget = null;
    offFfmpeg = null;
    unregisterStatus = null;
    instance = null;
    ctx = null;
    session = null;
  },
};
