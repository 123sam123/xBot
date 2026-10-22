// Owned by T9 (XBOT-OE2XV9). Already wired into services/index.ts (after drafts, whose drafts it posts).
// The only x module that imports electron: it hands Electron's fetch,
// safeStorage and shell to the electron-free service (service.ts).
import { net, safeStorage } from 'electron';
import { isPreviewMode } from '../../paths';
import { openExternalIfAllowed } from '../../security';
import { registerStatusProvider, statusChanged } from '../../status';
import { hideComposer, showComposer } from '../../windows/composer';
import { drafts } from '../drafts';
import { settings } from '../settings';
import type { ServiceModule } from '../types';
import { createXService, type XService } from './service';
import { createVault } from './vault';

let instance: XService | null = null;
let unregisterStatus: (() => void) | null = null;
let offSettings: (() => void) | null = null;

export function x(): XService {
  if (!instance) throw new Error('x service used before initServices()');
  return instance;
}

/** Quit waits on this: it resolves at once unless a create-post request is in flight (then at most `maxMs`). */
export function settleXForQuit(maxMs: number): Promise<void> {
  return instance?.settleForQuit(maxMs) ?? Promise.resolve();
}

export const xModule: ServiceModule = {
  name: 'x',
  init(ctx) {
    const preview = isPreviewMode(process.argv, process.env);
    instance = createXService({
      db: ctx.db,
      log: ctx.log,
      // Chromium's network stack: the system proxy and certificates, and no cookie jar (credentials: 'omit').
      // Preview mode (T10) never reaches X, on top of the service's own `preview_mode` refusals.
      fetch: preview ? () => Promise.reject(new Error('X is off in preview mode.')) : (url, init) => net.fetch(url, init),
      vault: createVault(safeStorage, process.platform),
      drafts: drafts(),
      mediaRoot: ctx.paths.media,
      emit: (name, payload) => void (ctx.events as unknown as NodeJS.EventEmitter).emit(name, payload),
      config: () => ({ clientId: settings().get('x.clientId'), port: settings().get('x.callbackPort') }),
      openBrowser: (url) => openExternalIfAllowed(url),
      // The always-on-top panel would cover X's consent page.
      beforeBrowser: () => hideComposer(),
      afterAnswer: () => showComposer(),
      preview,
    });
    instance.init();
    unregisterStatus = registerStatusProvider({ id: 'x', order: 40, get: () => instance?.status() ?? null });
    const onSettings = ({ key }: { key: string }) => {
      if (key.startsWith('x.')) statusChanged();
    };
    ctx.events.on('settings:changed', onSettings);
    offSettings = () => ctx.events.off('settings:changed', onSettings);
  },
  dispose() {
    instance?.dispose();
    unregisterStatus?.();
    offSettings?.();
    instance = null;
    unregisterStatus = null;
    offSettings = null;
  },
};
