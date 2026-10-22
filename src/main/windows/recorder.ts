import { BrowserWindow, screen, type Rectangle, type WebContents } from 'electron';
import { loadPage, manageGlass, manageWindow, materialOptions, secureWebPreferences } from './common';

// The recorder's windows, one `recorder` page in four modes:
// - panel: the glass "New recording" panel (source, camera, microphone, Start);
// - camera: the round camera bubble, draggable, above everything;
// - bar: the stop bar while recording (stop, timer, pause, restart, delete);
// - area: a full-display overlay to drag out the area to record.
// They float over every app and Space. ScreenCaptureKit leaves all of xBot's
// windows out of a display recording, so none of them is ever recorded.

export type RecorderMode = 'panel' | 'camera' | 'bar' | 'area';

const PANEL = { width: 360, height: 548 };
const CAMERA = 230;
const BAR = { width: 300, height: 64 };

const windows = new Map<RecorderMode, BrowserWindow>();

/** Pages allowed to use the camera and microphone. */
export function isRecorderContents(contents: WebContents): boolean {
  for (const win of windows.values()) if (!win.isDestroyed() && win.webContents.id === contents.id) return true;
  return false;
}

function create(mode: RecorderMode): BrowserWindow {
  const existing = windows.get(mode);
  if (existing && !existing.isDestroyed()) return existing;
  const glass = mode === 'panel';
  const win = new BrowserWindow({
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: mode === 'panel',
    focusable: mode === 'panel' || mode === 'area',
    title: 'xBot — Recorder',
    ...(process.platform === 'darwin' ? { type: 'panel', hiddenInMissionControl: true } : {}),
    ...(glass ? materialOptions() : { transparent: true, backgroundColor: '#00000000' }),
    webPreferences: secureWebPreferences(),
  });
  win.setAlwaysOnTop(true, mode === 'panel' ? 'floating' : 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  manageWindow(win, 'recorder', { mode });
  if (glass) manageGlass(win);
  void loadPage(win, 'recorder', { mode });
  windows.set(mode, win);
  return win;
}

/** Creates the windows up front, so the first Record is instant. */
export function createRecorderWindows(): void {
  for (const mode of ['panel', 'camera', 'bar'] as const) create(mode);
}

function displayUnderCursor() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

export function showPanel(): void {
  const win = create('panel');
  const { workArea } = displayUnderCursor();
  win.setBounds({ x: Math.round(workArea.x + (workArea.width - PANEL.width) / 2), y: workArea.y + 24, ...PANEL });
  win.show();
  win.focus();
}

export function hidePanel(): void {
  windows.get('panel')?.hide();
}

export function panelWindow(): BrowserWindow | null {
  return windows.get('panel') ?? null;
}

let cameraPlaced = false;

export function showCamera(): void {
  const win = create('camera');
  if (!cameraPlaced) {
    const { workArea } = displayUnderCursor();
    win.setBounds({ x: workArea.x + 32, y: workArea.y + workArea.height - CAMERA - 32, width: CAMERA, height: CAMERA });
    cameraPlaced = true;
  }
  win.showInactive();
}

export function hideCamera(): void {
  windows.get('camera')?.hide();
}

export function showBar(): void {
  const win = create('bar');
  const { workArea } = displayUnderCursor();
  win.setBounds({ x: Math.round(workArea.x + (workArea.width - BAR.width) / 2), y: workArea.y + workArea.height - BAR.height - 28, ...BAR });
  win.showInactive();
}

export function hideBar(): void {
  windows.get('bar')?.hide();
}

/** Covers display `displayId` with the area overlay. */
export function showArea(displayId: number): Rectangle {
  const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? displayUnderCursor();
  const win = create('area');
  win.setBounds(display.bounds);
  win.show();
  win.focus();
  return display.bounds;
}

export function hideArea(): void {
  windows.get('area')?.hide();
}
