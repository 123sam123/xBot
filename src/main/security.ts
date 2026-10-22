import { app, session, shell } from 'electron';
import { log } from './log';

// App-wide hardening for every webContents: no navigation away from xBot's
// pages, no new windows, no <webview>, no permissions. Links to a short list of
// https hosts open in the user's browser instead.

const EXTERNAL_HOSTS = new Set(['x.com', 'twitter.com', 'ollama.com', 'github.com']);

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

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    log.warn('security: denied permission request', permission);
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setDevicePermissionHandler(() => false);
}
