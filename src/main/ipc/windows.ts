import { app, BrowserWindow } from 'electron';
import { z } from 'zod';
import { windowsChannels } from '../../shared/contracts/windows.channels';
import { resizeComposerSchema } from '../../shared/contracts/windows';
import { refreshGlassShadow } from '../windows/common';
import { resizeComposer, showComposer } from '../windows/composer';
import { hold, release } from '../windows/hold';
import { openStudio } from '../windows/studio';
import { handle } from './register';

export function registerWindowsIpc(): void {
  handle(windowsChannels.hide, z.undefined(), (_payload, event) => {
    BrowserWindow.fromWebContents(event.sender)?.hide();
    return null;
  });
  handle(windowsChannels.hold, z.undefined(), (_payload, event) => {
    hold(event.sender);
    return null;
  });
  handle(windowsChannels.release, z.undefined(), (_payload, event) => {
    release(event.sender);
    return null;
  });
  handle(windowsChannels.resizeComposer, resizeComposerSchema, ({ height }) => {
    resizeComposer(height);
    return null;
  });
  handle(windowsChannels.showComposer, z.undefined(), () => {
    showComposer();
    return null;
  });
  handle(windowsChannels.openStudio, z.undefined(), () => {
    openStudio();
    return null;
  });
  handle(windowsChannels.showEmojiPanel, z.undefined(), () => {
    if (!app.isEmojiPanelSupported()) return null;
    // The composer is a non-activating panel: activate xBot so the picker
    // types into its focused editor, not into the previously active app.
    app.focus({ steal: true });
    app.showEmojiPanel();
    return null;
  });
  handle(windowsChannels.refreshGlassShadow, z.undefined(), (_payload, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) refreshGlassShadow(win);
    return null;
  });
}
