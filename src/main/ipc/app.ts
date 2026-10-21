import { app } from 'electron';
import { z } from 'zod';
import { appChannels } from '../../shared/contracts/app.channels';
import type { AppInfo } from '../../shared/contracts/app';
import { isPreviewMode } from '../paths';
import { currentStatuses } from '../status';
import { handle } from './register';

export function registerAppIpc(): void {
  handle(appChannels.getInfo, z.undefined(), (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    isPreview: isPreviewMode(process.argv, process.env),
    emojiPanel: app.isEmojiPanelSupported(),
  }));
  handle(appChannels.getStatus, z.undefined(), () => currentStatuses());
}
