// Owned by T4/T5 (XBOT-1N58PP, XBOT-G66JJK). Implement `StudioApi` (src/shared/contracts/studio.ts) with `invoke`.
import { webUtils } from 'electron';
import type { StudioApi } from '../../shared/contracts/studio';
import { studioChannels } from '../../shared/contracts/studio.channels';
import { invoke } from '../invoke';

/** The payload schema's bounds; main opens the first image and names the rest. */
const MAX_FILES = 200;
const MAX_NAME = 255;

export const studio: StudioApi = {
  current: () => invoke(studioChannels.current),
  pick: () => invoke(studioChannels.pick),
  // Only the preload can turn dropped Files into paths (File.path is gone).
  importFiles: (files) =>
    invoke(studioChannels.import, {
      files: files.slice(0, MAX_FILES).map((file) => ({ name: file.name.slice(0, MAX_NAME), path: webUtils.getPathForFile(file) })),
    }),
  save: (documentId, baseRevision, composition) => invoke(studioChannels.save, { documentId, baseRevision, composition }),
  pickMedia: (purpose) => invoke(studioChannels.pickMedia, { purpose }),
  listPresets: () => invoke(studioChannels.listPresets),
  savePreset: (name, style) => invoke(studioChannels.savePreset, { name, style }),
  deletePreset: (id) => invoke(studioChannels.deletePreset, { id }),
  addToPost: (documentId, baseRevision, composition, bytes) => invoke(studioChannels.addToPost, { documentId, baseRevision, composition, bytes }),
  toggleFullscreen: () => invoke(studioChannels.toggleFullscreen),
  flushed: () => invoke(studioChannels.flushed),
};
