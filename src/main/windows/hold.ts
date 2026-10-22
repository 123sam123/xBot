import type { BrowserWindow, WebContents } from 'electron';

// The hold guard: while a window is "held" (a native picker, a dialog or an
// internal popover is open), blur does not hide it. Counted per webContents and
// reset whenever the window hides or reloads, so a lost release cannot disable
// blur-hide for good.

const holds = new Map<number, number>();

export function hold(contents: WebContents): void {
  holds.set(contents.id, (holds.get(contents.id) ?? 0) + 1);
}

export function release(contents: WebContents): void {
  const next = (holds.get(contents.id) ?? 0) - 1;
  if (next > 0) holds.set(contents.id, next);
  else holds.delete(contents.id);
}

export function isHeld(contents: WebContents): boolean {
  return (holds.get(contents.id) ?? 0) > 0;
}

export function resetHold(contents: WebContents): void {
  holds.delete(contents.id);
}

/**
 * Runs `fn` (typically a `dialog.*` call) with `win` held and its always-on-top
 * level lifted, so the dialog is not hidden behind the panel and its focus
 * change does not hide the window. Use it for every dialog parented to xBot.
 */
export async function withHold<T>(win: BrowserWindow, fn: () => Promise<T>): Promise<T> {
  const wasOnTop = win.isAlwaysOnTop();
  hold(win.webContents);
  if (wasOnTop) win.setAlwaysOnTop(false);
  try {
    return await fn();
  } finally {
    if (!win.isDestroyed()) {
      if (wasOnTop) win.setAlwaysOnTop(true, 'pop-up-menu');
      // The dialog can leave the window unfocused; without focus it never
      // blurs again, and an outside click would stop hiding it.
      if (win.isVisible() && !win.isFocused()) win.focus();
      release(win.webContents);
    }
  }
}
