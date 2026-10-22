// Owned by T7 (XBOT-5UVE6R). A thin layer: payloads are validated here, the
// folder picker runs here (main decides which folders exist), and the
// services' IpcErrors pass straight through `handle()`.
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, sep } from 'node:path';
import { app, dialog } from 'electron';
import { z } from 'zod';
import { ideaCopy } from '../../shared/ideaCopy';
import {
  addNoteSchema,
  ideaIdSchema,
  projectIdSchema,
  refreshIdeasSchema,
  saveBriefSchema,
  type PickResult,
} from '../../shared/contracts/projects';
import { projectsChannels } from '../../shared/contracts/projects.channels';
import { isPreviewMode } from '../paths';
import { projects, suggestions } from '../services/projects';
import { folderRefusal } from '../services/projects/folderPolicy';
import { composerWindow } from '../windows/composer';
import { withHold } from '../windows/hold';
import { IpcError } from './core';
import { handle } from './register';

/**
 * The native folder picker. The composer is a non-activating panel, so xBot
 * may not be the active app: activate it first, or the dialog can open behind
 * another app. `dialog` is read at call time so tests can stub it.
 */
async function pickFolders(): Promise<string[]> {
  const win = composerWindow();
  app.focus({ steal: true });
  const show = () =>
    dialog.showOpenDialog({
      title: 'Choose project folders',
      buttonLabel: 'Add',
      message: 'xBot reads README files, docs, manifests and commit messages from these folders, and never runs code from them.',
      properties: ['openDirectory', 'multiSelections'],
    });
  const result = win && !win.isDestroyed() ? await withHold(win, show) : await show();
  return result.canceled ? [] : result.filePaths;
}

async function pick(): Promise<PickResult> {
  if (isPreviewMode(process.argv, process.env)) throw new IpcError('projects_preview', ideaCopy.pickPreview);
  const paths = await pickFolders();
  const out: PickResult = { projects: projects().list(), added: [], rejected: [], notes: [] };
  if (paths.length === 0) return out;
  const approved = projects().approvedRoots();
  const allowed: string[] = [];
  for (const path of paths) {
    let real: string;
    try {
      real = await realpath(path);
    } catch {
      out.rejected.push({ name: basename(path) || path, reason: 'That folder no longer exists.' });
      continue;
    }
    const refusal = folderRefusal(real, { home: homedir(), userData: app.getPath('userData') });
    if (refusal) {
      out.rejected.push({ name: basename(real) || real, reason: refusal });
      continue;
    }
    const parent = approved.find((p) => real.startsWith(p.real + sep));
    if (parent) out.notes.push(`“${basename(real)}” is inside “${parent.name}”, which is already added.`);
    allowed.push(path);
  }
  const { added, rejected } = await projects().add(allowed);
  out.added = added.map((p) => p.name);
  out.rejected.push(...rejected);
  out.projects = projects().list();
  return out;
}

export function registerProjectsIpc(): void {
  handle(projectsChannels.list, z.undefined(), () => projects().list());
  handle(projectsChannels.pick, z.undefined(), () => pick());
  handle(projectsChannels.remove, projectIdSchema, ({ id }) => projects().remove(id));
  handle(projectsChannels.rescan, projectIdSchema, ({ id }) => projects().rescan(id));
  handle(projectsChannels.saveBrief, saveBriefSchema, ({ id, brief, options }) => projects().saveBrief(id, brief, options));
  handle(projectsChannels.addNote, addNoteSchema, ({ projectId, text }) => {
    projects().addNote(projectId, text);
    // A note is an explicit request for ideas about it; the outcome arrives as `projects:ideas-changed`.
    suggestions()
      .refresh('force', 'interactive', projectId ?? '')
      .catch(() => undefined);
    return null;
  });
  handle(projectsChannels.ideas, z.undefined(), () => suggestions().state());
  handle(projectsChannels.refreshIdeas, refreshIdeasSchema, ({ mode }) => suggestions().refresh(mode, mode === 'force' ? 'interactive' : 'background'));
  handle(projectsChannels.cancelIdeas, z.undefined(), () => {
    suggestions().cancel();
    return null;
  });
  handle(projectsChannels.useIdea, ideaIdSchema, ({ id }) => suggestions().use(id));
  handle(projectsChannels.dismissIdea, ideaIdSchema, ({ id }) => suggestions().dismiss(id));
}
