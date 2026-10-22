// Owned by T3 (XBOT-6F4GAC).
import { webUtils } from 'electron';
import type { MediaApi } from '../../shared/contracts/media';
import { mediaChannels } from '../../shared/contracts/media.channels';
import { invoke } from '../invoke';

/** The payload schema's bounds; main imports at most 20 and rejects the rest by name. */
const MAX_FILES = 200;
const MAX_NAME = 255;

export const media: MediaApi = {
  // The renderer hands over dropped File objects; only the preload can turn
  // them into paths (File.path is gone). A File that is not on disk, such as
  // an image dragged out of a browser, gets '' and main rejects it by name.
  importFiles: (draftId, files) =>
    invoke(mediaChannels.import, {
      draftId,
      files: files.slice(0, MAX_FILES).map((file) => ({ name: file.name.slice(0, MAX_NAME), path: webUtils.getPathForFile(file) })),
    }),
  pick: (draftId) => invoke(mediaChannels.pick, { draftId }),
  exportForDraft: (draftId) => invoke(mediaChannels.export, { draftId }),
};
