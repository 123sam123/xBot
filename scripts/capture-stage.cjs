// A bare Electron main process for the capture scripts (scripts/capture-ui.ts,
// scripts/render-fixtures.ts). It loads nothing of xBot's: the scripts drive it
// through Playwright, create their own windows and set their content. CommonJS,
// because Playwright's Electron loader does not wait for an ES-module main.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS by necessity (see above)
const { app } = require('electron');

app.on('window-all-closed', () => {});
