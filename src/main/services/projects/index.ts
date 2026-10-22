// Owned by T7 (XBOT-5UVE6R). Already wired into services/index.ts (after ai, whose generateTask it uses).
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { app } from 'electron';
import type { IdeasState, ProjectSummary } from '../../../shared/contracts/projects';
import { isPreviewMode } from '../../paths';
import { ai } from '../ai';
import type { ServiceModule } from '../types';
import { findGit } from './git';
import { createProjectsService, type ProjectsService } from './service';
import { createSuggestionsService, type SuggestionsService } from './suggestions';

let projectsInstance: ProjectsService | null = null;
let suggestionsInstance: SuggestionsService | null = null;

/** The approved folders. T8: `projects().hasNewActivitySince(ts)`. */
export function projects(): ProjectsService {
  if (!projectsInstance) throw new Error('projects service used before initServices()');
  return projectsInstance;
}

/** The ideas list. T8: `suggestions().getTopRelevant()` and `suggestions().refresh('auto', 'background')`. */
export function suggestions(): SuggestionsService {
  if (!suggestionsInstance) throw new Error('suggestions service used before initServices()');
  return suggestionsInstance;
}

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const projectsModule: ServiceModule = {
  name: 'projects',
  init(ctx) {
    const preview = isPreviewMode(process.argv, process.env);
    // Each name/payload pair is typed by ProjectsEvents; the bus's generic signature can't follow it.
    const emit = (name: string, payload: unknown) => (ctx.events.emit as (n: string, p: unknown) => boolean).call(ctx.events, name, payload);
    let git: Promise<string | null> | null = null;
    const home = homedir();

    const ideas = createSuggestionsService({
      db: ctx.db,
      log: ctx.log,
      isPreview: preview,
      generate: (req) => ai().generateTask(req),
      cancel: (requestId) => ai().cancel(requestId),
      bannedPhrases: () => ai().getVoice().bannedPhrases,
      emit: (state: IdeasState) => emit('projects:ideas-changed', state),
    });
    const service = createProjectsService({
      db: ctx.db,
      log: ctx.log,
      isPreview: preview,
      home,
      scanner: {
        findGit: () => (git ??= findGit({ platform: process.platform, isPackaged: app.isPackaged, env: process.env, isExecutable })),
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
        home,
      },
      onChanged: (list: ProjectSummary[]) => emit('projects:changed', { projects: list }),
      onActivity: () => ideas.activityChanged(),
    });
    projectsInstance = service;
    suggestionsInstance = ideas;
    service.start();
  },
  dispose() {
    suggestionsInstance?.dispose();
    projectsInstance?.dispose();
    suggestionsInstance = null;
    projectsInstance = null;
  },
};
