// Owned by T4/T5 (XBOT-1N58PP, XBOT-G66JJK). Register `studio:*` handlers here with `handle(channel, schema, fn)`.
import { basename } from 'node:path';
import { dialog, type OpenDialogOptions } from 'electron';
import { z } from 'zod';
import type { MediaItem } from '../../shared/contracts/media';
import {
  addToPostSchema,
  documentIdSchema,
  exportVideoSchema,
  jobIdSchema,
  pickMediaSchema,
  presetIdSchema,
  saveCompositionSchema,
  savePresetSchema,
  studioImportSchema,
  type StudioImportResult,
} from '../../shared/contracts/studio';
import { studioChannels } from '../../shared/contracts/studio.channels';
import { appEvents } from '../events';
import { draftsQueue } from '../services/drafts/queue';
import { ffmpeg } from '../services/ffmpeg';
import { media } from '../services/media';
import { MediaRejected } from '../services/media/service';
import { adoptOpened, beginOpen, currentSession, isLatestOpen, openedFromAttachment, studio } from '../services/studio';
import type { Opened } from '../services/studio/service';
import { studioWindow, toggleStudioFullscreen } from '../windows/studio';
import { IpcError } from './core';
import { handle } from './register';

const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }];
const MEDIA_FILTERS = [{ name: 'Images and video', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'm4v'] }];
const ONE_AT_A_TIME = 'Media Studio edits one image or video at a time.';

let flushAck: (() => void) | null = null;

/**
 * Asks the Studio to save pending edits and waits for its ack, at most
 * `timeoutMs`; the same rules as `requestDraftFlush`.
 */
export function requestStudioFlush(timeoutMs: number): Promise<void> {
  const win = studioWindow();
  if (!win || win.isDestroyed() || win.webContents.isCrashed() || win.webContents.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      flushAck = null;
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    flushAck = done;
    appEvents.emit('studio:flush-requested', {});
  });
}

/** A file picker parented to the Studio. `dialog` is read at call time so tests can stub it. */
async function pickPath(title: string, filters: OpenDialogOptions['filters']): Promise<string | null> {
  const win = studioWindow();
  const options: OpenDialogOptions = { title, buttonLabel: 'Open', properties: ['openFile'], filters };
  const result = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Imports one file as loose media (no draft), on the drafts/media queue. */
async function importMedia(name: string, path: string, imagesOnly: boolean): Promise<MediaItem> {
  try {
    const item = await draftsQueue(() => media().importLoose({ name, path }));
    if (imagesOnly && item.kind !== 'image') throw new IpcError('not_an_image', 'Choose an image here.');
    return item;
  } catch (err) {
    if (err instanceof MediaRejected) throw new IpcError('media_rejected', err.message);
    throw err;
  }
}

/** Opens `item` in the Studio: a document, or a read-only video while FFmpeg is missing. */
async function open(item: MediaItem): Promise<Opened> {
  const ticket = beginOpen();
  const opened = await studio().openForMedia(item);
  if (!isLatestOpen(ticket)) throw new IpcError('superseded', 'Another file opened first.');
  return adoptOpened(opened, null);
}

export function registerStudioIpc(): void {
  handle(studioChannels.current, z.undefined(), () => currentSession());

  handle(studioChannels.pick, z.undefined(), async () => {
    const path = await pickPath('Open an image or video', MEDIA_FILTERS);
    return path ? open(await importMedia(basename(path), path, false)) : null;
  });

  handle(studioChannels.import, studioImportSchema, async ({ files }): Promise<StudioImportResult> => {
    const ignored: StudioImportResult['ignored'] = [];
    let opened: Opened | null = null;
    for (const file of files) {
      if (opened) {
        ignored.push({ name: file.name, message: ONE_AT_A_TIME });
        continue;
      }
      if (!file.path) {
        ignored.push({ name: file.name, message: `Couldn’t read ${file.name}. Drag it from Finder instead.` });
        continue;
      }
      try {
        opened = await open(await importMedia(file.name, file.path, false));
      } catch (err) {
        if (!(err instanceof IpcError)) throw err;
        ignored.push({ name: file.name, message: err.message });
      }
    }
    if (!opened) throw new IpcError(ignored.length === 1 ? 'media_rejected' : 'no_media', ignored[0]?.message ?? 'Drop an image or a video to edit.');
    return { opened, ignored };
  });

  handle(studioChannels.save, saveCompositionSchema, ({ documentId, baseRevision, composition }) =>
    studio().save(documentId, baseRevision, composition),
  );

  handle(studioChannels.pickMedia, pickMediaSchema, async ({ purpose }) => {
    const path = await pickPath(purpose === 'source' ? 'Replace the source image' : 'Choose a background image', IMAGE_FILTERS);
    return path ? importMedia(basename(path), path, true) : null;
  });

  handle(studioChannels.listPresets, z.undefined(), () => studio().listPresets());
  handle(studioChannels.savePreset, savePresetSchema, ({ name, style }) => studio().savePreset(name, style));
  handle(studioChannels.deletePreset, presetIdSchema, ({ id }) => {
    studio().deletePreset(id);
    return null;
  });

  handle(studioChannels.addToPost, addToPostSchema, (payload) => {
    // Captured now: an "Edit in Studio ↗" while this waits must not redirect it.
    const openedFromAttachmentId = openedFromAttachment(payload.documentId);
    return draftsQueue(() => studio().addToPost({ ...payload, openedFromAttachmentId }));
  });

  handle(studioChannels.exportVideo, exportVideoSchema, (payload) =>
    // Not on the drafts queue: only the finished MP4's import and attach go there.
    studio().exportVideo({ ...payload, openedFromAttachmentId: openedFromAttachment(payload.documentId) }),
  );

  handle(studioChannels.cancelExport, jobIdSchema, ({ jobId }) => studio().cancelExport(jobId));

  handle(studioChannels.filmstrip, documentIdSchema, ({ documentId }) => studio().filmstrip(documentId));

  handle(studioChannels.ffmpegStatus, z.undefined(), () => ffmpeg().status());

  // A read-only video view turns into a document once FFmpeg is ready (the
  // studio module listens for `studio:ffmpeg`).
  handle(studioChannels.ffmpegCheck, z.undefined(), () => ffmpeg().recheck());

  handle(studioChannels.locateFfmpeg, z.undefined(), async () => {
    const path = await pickPath('Locate FFmpeg', undefined);
    return path ? ffmpeg().setUserPath(path) : null;
  });

  handle(studioChannels.toggleFullscreen, z.undefined(), () => toggleStudioFullscreen());

  handle(studioChannels.flushed, z.undefined(), (_payload, event) => {
    if (event.sender === studioWindow()?.webContents) flushAck?.();
    return null;
  });
}
