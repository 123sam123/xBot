// Owned by T3 (XBOT-6F4GAC). Already wired into services/index.ts (after drafts, which it attaches to).
import { registerStatusProvider } from '../../status';
import { drafts } from '../drafts';
import type { ServiceModule } from '../types';
import { createMediaService, type MediaService } from './service';
import { electronMediaTools } from './tools';

let instance: MediaService | null = null;
let unregisterStatus: (() => void) | null = null;

export function media(): MediaService {
  if (!instance) throw new Error('media service used before initServices()');
  return instance;
}

export const mediaModule: ServiceModule = {
  name: 'media',
  async init(ctx) {
    instance = createMediaService({ db: ctx.db, paths: ctx.paths, log: ctx.log, tools: electronMediaTools(ctx.log), drafts: drafts() });
    await instance.init();
    unregisterStatus = registerStatusProvider({
      id: 'media-export',
      order: 90,
      get: () => (instance?.exporting() ? { id: 'media-export', label: 'Export running', tone: 'busy' } : null),
    });
  },
  dispose() {
    instance?.dispose();
    unregisterStatus?.();
    instance = null;
    unregisterStatus = null;
  },
};
