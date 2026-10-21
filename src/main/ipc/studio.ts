// Owned by T4/T5 (XBOT-1N58PP, XBOT-G66JJK). Register `studio:*` handlers here with `handle(channel, schema, fn)`.
import { basename } from 'node:path';
import { dialog, type OpenDialogOptions } from 'electron';
import { z } from 'zod';
import type { MediaItem } from '../../shared/contracts/media';
import {
  addToPostSchema,
  pickMediaSchema,
  presetIdSchema,
  saveCompositionSchema,
  savePresetSchema,
  studioImportSchema,
  type StudioDocument,
  type StudioImportResult,
} from '../../shared/contracts/studio';
import { studioChannels } from '../../shared/contracts/studio.channels';
import { appEvents } from '../events';
import { isPreviewMode } from '../paths';
import { draftsQueue } from '../services/drafts/queue';
import { media } from '../services/media';
import { MediaRejected } from '../services/media/service';
import { currentSession, openedFromAttachment, setStudioDocument, studio } from '../services/studio';
import { studioWindow, toggleStudioFullscreen } from '../windows/studio';
import { IpcError } from './core';
import { handle } from './register';

const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }];
const ONE_AT_A_TIME = 'Media Studio edits one image at a time.';

let flushAck: (() => void) | null = null;

/**
 * Asks the Studio to save pending edits and waits for its ack, at most
 * `timeoutMs`; the same rules as `requestDraftFlush`.
 */
export function requestStudioFlush(timeoutMs: number): Promise<void> {
  const win = studioWindow();
  if (isPreviewMode(process.argv, process.env)) return Promise.resolve();
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

/** An image picker parented to the Studio. `dialog` is read at call time so tests can stub it. */
async function pickImagePath(title: string): Promise<string | null> {
  const win = studioWindow();
  const options: OpenDialogOptions = { title, buttonLabel: 'Open', properties: ['openFile'], filters: IMAGE_FILTERS };
  const result = win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Imports one file as loose media (no draft), on the drafts/media queue. */
async function importImage(name: string, path: string): Promise<MediaItem> {
  try {
    const item = await draftsQueue(() => media().importLoose({ name, path }));
    if (item.kind !== 'image') throw new IpcError('not_an_image', 'Media Studio edits images. Add videos from Write Post.');
    return item;
  } catch (err) {
    if (err instanceof MediaRejected) throw new IpcError('media_rejected', err.message);
    throw err;
  }
}

function open(item: MediaItem): StudioDocument {
  const document = studio().openForMedia(item);
  setStudioDocument(document.id, null);
  return document;
}

export function registerStudioIpc(): void {
  handle(studioChannels.current, z.undefined(), () => currentSession());

  handle(studioChannels.pick, z.undefined(), async () => {
    const path = await pickImagePath('Open an image');
    return path ? open(await importImage(basename(path), path)) : null;
  });

  handle(studioChannels.import, studioImportSchema, async ({ files }): Promise<StudioImportResult> => {
    const ignored: StudioImportResult['ignored'] = [];
    let document: StudioDocument | null = null;
    for (const file of files) {
      if (document) {
        ignored.push({ name: file.name, message: ONE_AT_A_TIME });
        continue;
      }
      if (!file.path) {
        ignored.push({ name: file.name, message: `Couldn’t read ${file.name}. Drag it from Finder instead.` });
        continue;
      }
      try {
        document = open(await importImage(file.name, file.path));
      } catch (err) {
        if (!(err instanceof IpcError)) throw err;
        ignored.push({ name: file.name, message: err.message });
      }
    }
    if (!document) throw new IpcError(ignored.length === 1 ? 'media_rejected' : 'no_image', ignored[0]?.message ?? 'Drop an image to edit.');
    return { document, ignored };
  });

  handle(studioChannels.save, saveCompositionSchema, ({ documentId, baseRevision, composition }) =>
    studio().save(documentId, baseRevision, composition),
  );

  handle(studioChannels.pickMedia, pickMediaSchema, async ({ purpose }) => {
    const path = await pickImagePath(purpose === 'source' ? 'Replace the source image' : 'Choose a background image');
    return path ? importImage(basename(path), path) : null;
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

  handle(studioChannels.toggleFullscreen, z.undefined(), () => toggleStudioFullscreen());

  handle(studioChannels.flushed, z.undefined(), (_payload, event) => {
    if (event.sender === studioWindow()?.webContents) flushAck?.();
    return null;
  });
}
