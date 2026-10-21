import { app, dialog } from 'electron';
import { bundledMigrations, openDatabase, type Db } from './db';
import { migrate } from './db/migrate';
import { appEvents, forwardEventsToRenderers } from './events';
import { registerIpc } from './ipc';
import { log } from './log';
import { installAppMenu } from './menu';
import type { AppPaths } from './paths';
import { handleMediaProtocol } from './protocols/media';
import { installSecurityHandlers } from './security';
import { disposeServices, initServices } from './services';
import { createTray } from './tray';
import { markQuitting } from './windows/common';
import { createComposerWindow, toggleComposer } from './windows/composer';
import { createStudioWindow, openStudio } from './windows/studio';

let db: Db | null = null;

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

  createComposerWindow();
  createStudioWindow();
  createTray();
  installAppMenu();

  app.on('second-instance', () => toggleComposer());
  app.on('activate', () => toggleComposer());
  app.on('before-quit', () => markQuitting());
  app.on('will-quit', () => {
    void disposeServices();
    db?.close();
    db = null;
  });
  // A menu-bar app keeps running with no windows.
  app.on('window-all-closed', () => {});

  if (!app.isPackaged && process.env.XBOT_E2E === '1') {
    // Test seam for the Playwright smoke test: drive the real code paths.
    (globalThis as Record<string, unknown>).__xbotTest = { toggleComposer, openStudio };
  }

  log.info('xBot ready', { userData: paths.userData, version: app.getVersion() });
}
