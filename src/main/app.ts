import { app, dialog } from 'electron';
import { bundledMigrations, openDatabase, type Db } from './db';
import { migrate } from './db/migrate';
import { appEvents, forwardEventsToRenderers } from './events';
import { registerIpc } from './ipc';
import { requestDraftFlush } from './ipc/drafts';
import { requestStudioFlush } from './ipc/studio';
import { log } from './log';
import { installAppMenu } from './menu';
import type { AppPaths } from './paths';
import { handleMediaProtocol } from './protocols/media';
import { installSecurityHandlers } from './security';
import { disposeServices, initServices } from './services';
import { onStatusChanged } from './status';
import { createTray } from './tray';
import { applyAppearance, markQuitting } from './windows/common';
import { createComposerWindow, toggleComposer } from './windows/composer';
import { createStudioWindow, openStudio } from './windows/studio';

let db: Db | null = null;
/** How long quitting waits for the composer to save typed text and the Studio its edits. */
const QUIT_FLUSH_MS = 1000;

function openAndMigrate(paths: AppPaths): Db | null {
  let opened: Db | null = null;
  try {
    opened = openDatabase(paths.db);
    migrate(opened, bundledMigrations(), log);
    return opened;
  } catch (err) {
    log.error('db: could not open or migrate', paths.db, err);
    opened?.close();
    // Show the problem and leave the file exactly as it is.
    dialog.showErrorBox(
      'xBot could not open its database',
      `${paths.db}\n\n${err instanceof Error ? err.message : String(err)}\n\nNothing was changed. xBot will quit.`,
    );
    return null;
  }
}

/** Everything after `app.whenReady()`, in the order ARCHITECTURE.md documents. */
export async function startApp(paths: AppPaths): Promise<void> {
  app.dock?.hide();

  db = openAndMigrate(paths);
  if (!db) {
    app.exit(1);
    return;
  }
  await initServices({ db, paths, events: appEvents, log });

  installSecurityHandlers();
  handleMediaProtocol(paths.media);
  registerIpc();
  forwardEventsToRenderers();
  onStatusChanged((statuses) => appEvents.emit('status:changed', { statuses }));

  applyAppearance();
  createComposerWindow();
  createStudioWindow();
  createTray();
  installAppMenu();

  app.on('second-instance', () => toggleComposer());
  app.on('activate', () => toggleComposer());
  // The first quit waits (at most QUIT_FLUSH_MS) for the composer to save text
  // and the Studio to save edits still inside their autosave debounce, then
  // quits for real.
  let flushedForQuit = false;
  app.on('before-quit', (event) => {
    if (!flushedForQuit) {
      flushedForQuit = true;
      event.preventDefault();
      void Promise.all([requestDraftFlush(QUIT_FLUSH_MS), requestStudioFlush(QUIT_FLUSH_MS)]).finally(() => app.quit());
      return;
    }
    markQuitting();
  });
  app.on('will-quit', () => {
    // Services first (an import may still be finishing), then the database.
    void disposeServices().finally(() => {
      db?.close();
      db = null;
    });
  });
  // A menu-bar app keeps running with no windows.
  app.on('window-all-closed', () => {});

  if (!app.isPackaged && process.env.XBOT_E2E === '1') {
    // Test seam for the Playwright smoke test: drive the real code paths.
    (globalThis as Record<string, unknown>).__xbotTest = { toggleComposer, openStudio };
  }

  log.info('xBot ready', { userData: paths.userData, version: app.getVersion() });
}
