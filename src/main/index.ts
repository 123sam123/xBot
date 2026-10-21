import { join } from 'node:path';
import { app } from 'electron';
import { log, setLogFile } from './log';
import { appPaths, prepareUserData, resolveUserDataDir } from './paths';
import { registerMediaScheme } from './protocols/media';
import { startApp } from './app';

// Startup order matters (see ARCHITECTURE.md → "Startup order"):
// userData → single-instance lock (it is per userData) → privileged schemes →
// sandbox → whenReady.

const userData = resolveUserDataDir({
  appData: app.getPath('appData'),
  isPackaged: app.isPackaged,
  argv: process.argv,
  env: process.env,
});
app.setPath('userData', userData);

if (!app.requestSingleInstanceLock()) {
  // Another xBot owns this userData; it receives `second-instance` and toggles its composer.
  app.quit();
} else {
  const paths = appPaths(userData);
  prepareUserData(paths);
  setLogFile(join(paths.logs, 'main.log'));

  registerMediaScheme();
  app.enableSandbox();

  app
    .whenReady()
    .then(() => startApp(paths))
    .catch((err: unknown) => {
      log.error('startup failed', err);
      app.exit(1);
    });
}
