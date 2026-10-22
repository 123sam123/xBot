import type { WindowsApi } from '../../shared/contracts/windows';
import { windowsChannels } from '../../shared/contracts/windows.channels';
import { invoke } from '../invoke';

export const windows: WindowsApi = {
  hide: () => invoke(windowsChannels.hide),
  hold: () => invoke(windowsChannels.hold),
  release: () => invoke(windowsChannels.release),
  resizeComposer: (height) => invoke(windowsChannels.resizeComposer, { height }),
  showComposer: () => invoke(windowsChannels.showComposer),
  minimize: () => invoke(windowsChannels.minimize),
  openStudio: () => invoke(windowsChannels.openStudio),
  showEmojiPanel: () => invoke(windowsChannels.showEmojiPanel),
  refreshGlassShadow: () => invoke(windowsChannels.refreshGlassShadow),
};
