import { app, session, shell } from 'electron';
import { log } from './log';
import { isRecorderContents } from './windows/recorder';

// App-wide hardening for every webContents: no navigation away from xBot's
// pages, no new windows, no <webview>, no permissions except the camera and
// microphone for the recorder's own windows. Links to a short list of https
// hosts open in the user's browser instead.

// ffmpeg.org and brew.sh: the Studio's "how to get FFmpeg" links (T5).
const EXTERNAL_HOSTS = new Set(['x.com', 'twitter.com', 'ollama.com', 'github.com', 'ffmpeg.org', 'brew.sh']);

export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return EXTERNAL_HOSTS.has(host) || [...EXTERNAL_HOSTS].some((h) => host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Opens an allowlisted https URL in the user's browser; anything else is logged and dropped. */
export function openExternalIfAllowed(url: string): void {
  if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  else log.warn('security: blocked external URL', url);
}

export function installSecurityHandlers(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      event.preventDefault();
      openExternalIfAllowed(url);
    });
    contents.on('will-redirect', (event, url) => {
      try {
        if (new URL(url).origin === new URL(contents.getURL()).origin) return;
      } catch {
        // fall through: block
      }
      event.preventDefault();
      log.warn('security: blocked redirect', url);
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      openExternalIfAllowed(url);
      return { action: 'deny' };
    });
  });

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const media = permission === 'media' && 'mediaTypes' in details && (details.mediaTypes ?? []).every((type) => type === 'video' || type === 'audio');
    if (media && isRecorderContents(contents)) return callback(true);
    log.warn('security: denied permission request', permission);
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => permission === 'media' && contents !== null && isRecorderContents(contents));
  session.defaultSession.setDevicePermissionHandler(() => false);
}
