// Owned by T3 (XBOT-6F4GAC).
import { basename } from 'node:path';
import { app, dialog, type OpenDialogOptions } from 'electron';
import { mediaChannels } from '../../shared/contracts/media.channels';
import { draftMediaSchema, importMediaSchema, type ImportResult } from '../../shared/contracts/media';
import { appEvents } from '../events';
import { log } from '../log';
import { drafts } from '../services/drafts';
import { draftsQueue } from '../services/drafts/queue';
import { media } from '../services/media';
import { composerWindow, showComposer } from '../windows/composer';
import { withHold } from '../windows/hold';
import { IpcError } from './core';
import { handle } from './register';

const MEDIA_FILTERS = [{ name: 'Images and video', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'm4v'] }];

/**
 * Runs a picker for the composer. The composer is a non-activating panel, so
 * xBot may not be the active app: activate it first, or a parentless dialog
 * can open behind another app. `dialog` is read at call time so tests can stub it.
 */
async function pickPaths(options: OpenDialogOptions): Promise<string[] | null> {
  const win = composerWindow();
  app.focus({ steal: true });
  const show = () => dialog.showOpenDialog(options);
  const result = win && !win.isDestroyed() ? await withHold(win, show) : await show();
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths;
}

/** Files dropped on the menu-bar icon go into the current draft. */
export function importDroppedOnTray(paths: readonly string[]): void {
  if (paths.length === 0) return;
  showComposer();
  void draftsQueue(async () => {
    const draftId = drafts().getCurrent().id;
    const { rejected } = await media().importFiles(
      draftId,
      paths.map((path) => ({ name: basename(path), path })),
    );
    appEvents.emit('media:imported', { draftId, rejected });
  }).catch((err: unknown) => log.error('media: menu-bar drop failed', err));
}

export function registerMediaIpc(): void {
  handle(mediaChannels.import, importMediaSchema, ({ draftId, files }) =>
    draftsQueue(() => media().importFiles(draftId, files)),
  );
  handle(mediaChannels.pick, draftMediaSchema, async ({ draftId }): Promise<ImportResult> => {
    const paths = await pickPaths({
      title: 'Add screenshots or video',
      buttonLabel: 'Add',
      properties: ['openFile', 'multiSelections'],
      filters: MEDIA_FILTERS,
    });
    if (!paths) return { draft: drafts().get(draftId), rejected: [] };
    return draftsQueue(() =>
      media().importFiles(
        draftId,
        paths.map((path) => ({ name: basename(path), path })),
      ),
    );
  });
  handle(mediaChannels.export, draftMediaSchema, async ({ draftId }) => {
    if (drafts().get(draftId).attachments.length === 0) throw new IpcError('no_media', 'This draft has no media to export.');
    const folder = (await pickPaths({ title: 'Export media', buttonLabel: 'Export', properties: ['openDirectory', 'createDirectory'] }))?.[0];
    if (!folder) return null;
    try {
      return await media().exportDraft(draftId, folder);
    } catch (err) {
      log.error('media: export failed', err);
      const code = (err as NodeJS.ErrnoException).code;
      throw new IpcError(
        'export_failed',
        code === 'ENOSPC' ? 'There isn’t enough space in that folder.' : code === 'EACCES' || code === 'EPERM' ? 'xBot can’t write to that folder.' : 'The media couldn’t be exported.',
      );
    }
  });
}
