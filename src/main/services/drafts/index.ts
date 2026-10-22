// Owned by T3 (XBOT-6F4GAC). Already wired into services/index.ts.
import type { StudioTarget } from '../../../shared/contracts/drafts';
import type { ServiceContext, ServiceModule } from '../types';
import { createDraftsService, type DraftsService } from './service';

let instance: DraftsService | null = null;
let events: ServiceContext['events'] | null = null;
let studioTarget: StudioTarget | null = null;

export function drafts(): DraftsService {
  if (!instance) throw new Error('drafts service used before initServices()');
  return instance;
}

/** The attachment "Edit in Studio ↗" last opened; the Studio page reads it after a reload. */
export function currentStudioTarget(): StudioTarget | null {
  return studioTarget;
}

export function setStudioTarget(target: StudioTarget): void {
  studioTarget = target;
  events?.emit('draft:studio-target', target);
}

export const draftsModule: ServiceModule = {
  name: 'drafts',
  init(ctx) {
    events = ctx.events;
    instance = createDraftsService(ctx.db, ctx);
  },
  dispose() {
    instance = null;
    events = null;
    studioTarget = null;
  },
};
