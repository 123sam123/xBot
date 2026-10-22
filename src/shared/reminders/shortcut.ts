// T8 (XBOT-8V5WV5): the global shortcut that toggles the composer. Electron
// accelerators ("Alt+CommandOrControl+X"), built from a key press in the
// settings field, checked before main registers them, and shown as ⌥⌘X.

export const DEFAULT_SHORTCUT = 'Alt+CommandOrControl+X';

type Modifier = 'ctrl' | 'alt' | 'shift' | 'cmd' | 'super';
const MODIFIER_ORDER: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'cmd', 'super'];

interface Parsed {
  modifiers: Set<Modifier>;
  key: string;
}

const KEY_ALIASES: Record<string, string> = { escape: 'Esc', esc: 'Esc', enter: 'Return', return: 'Return' };

/** Keys an accelerator may end with (besides A–Z, 0–9 and F1–F24). */
const NAMED_KEYS = new Set([
  'Space', 'Tab', 'Return', 'Esc', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'Up', 'Down', 'Left', 'Right', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`',
]);

function normalizeKey(raw: string): string | null {
  const alias = KEY_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase();
  if (/^f([1-9]|1\d|2[0-4])$/i.test(raw)) return raw.toUpperCase();
  const named = [...NAMED_KEYS].find((k) => k.toLowerCase() === raw.toLowerCase());
  return named ?? null;
}

function parse(accelerator: string, mac: boolean): Parsed | null {
  // "Plus" stands for the + key; it never appears here, so splitting on + is safe.
  const parts = accelerator.split('+').map((p) => p.trim());
  if (parts.length === 0 || parts.some((p) => p === '')) return null;
  const modifiers = new Set<Modifier>();
  for (const part of parts.slice(0, -1)) {
    switch (part.toLowerCase()) {
      case 'command':
      case 'cmd':
        modifiers.add('cmd');
        break;
      case 'control':
      case 'ctrl':
        modifiers.add('ctrl');
        break;
      case 'commandorcontrol':
      case 'cmdorctrl':
        modifiers.add(mac ? 'cmd' : 'ctrl');
        break;
      case 'alt':
      case 'option':
        modifiers.add('alt');
        break;
      case 'shift':
        modifiers.add('shift');
        break;
      case 'super':
      case 'meta':
        modifiers.add(mac ? 'cmd' : 'super');
        break;
      default:
        return null;
    }
  }
  const key = normalizeKey(parts.at(-1)!);
  return key ? { modifiers, key } : null;
}

function canonical(p: Parsed): string {
  return [...MODIFIER_ORDER.filter((m) => p.modifiers.has(m)), p.key].join('+');
}

/** Combinations macOS keeps for itself; `globalShortcut.register` can't tell, so xBot checks. */
const MAC_RESERVED = new Set([
  'ctrl+cmd+Space', // Character Viewer (xBot's own emoji button opens it)
  'alt+cmd+Space', // Finder search
  'alt+cmd+Esc', // Force Quit
  'shift+cmd+Q', // Log Out
  'ctrl+cmd+Q', // Lock Screen
  'ctrl+cmd+F', // Full screen
  'alt+cmd+D', // Dock hiding
  'alt+cmd+H', // Hide others
  'shift+cmd+/', // Help menu
  'shift+cmd+3', // Screenshots
  'shift+cmd+4',
  'shift+cmd+5',
]);

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Return',
  NumpadEnter: 'Return',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

export interface KeyPress {
  /** `KeyboardEvent.code`: the physical key, because ⌥ changes `key` on macOS (⌥X types ≈). */
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The accelerator for a key press, or null while only modifiers are held. */
export function acceleratorFromKeyPress(press: KeyPress, mac: boolean): string | null {
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(press.code)) key = press.code.slice(3);
  else if (/^Digit\d$/.test(press.code)) key = press.code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(press.code)) key = press.code;
  else key = CODE_KEYS[press.code];
  if (!key) return null;
  const parts: string[] = [];
  if (press.ctrlKey) parts.push('Control');
  if (press.altKey) parts.push('Alt');
  if (press.shiftKey) parts.push('Shift');
  if (press.metaKey) parts.push(mac ? 'Command' : 'Super');
  return [...parts, key].join('+');
}

/** Why xBot won't use `accelerator`, or null when it may try to register it. '' (off) is fine. */
export function shortcutProblem(accelerator: string, mac: boolean): string | null {
  if (accelerator === '') return null;
  const parsed = parse(accelerator, mac);
  if (!parsed) return 'xBot can’t use that key combination.';
  const functionKey = /^F\d+$/.test(parsed.key);
  const primary = parsed.modifiers.has('cmd') || parsed.modifiers.has('ctrl');
  if (!functionKey && (parsed.modifiers.size < 2 || !primary)) {
    return mac
      ? 'Use two modifier keys, including ⌘ or ⌃ (for example ⌥⌘X), so the shortcut doesn’t take a key other apps need.'
      : 'Use two modifier keys, including Ctrl (for example Ctrl+Alt+X), so the shortcut doesn’t take a key other apps need.';
  }
  if (mac && MAC_RESERVED.has(canonical(parsed))) return `macOS already uses ${formatAccelerator(accelerator, mac)}. Choose another shortcut.`;
  return null;
}

/** Two accelerators that mean the same keys on this platform. */
export function sameShortcut(a: string, b: string, mac: boolean): boolean {
  const pa = a === '' ? null : parse(a, mac);
  const pb = b === '' ? null : parse(b, mac);
  if (!pa || !pb) return a === b;
  return canonical(pa) === canonical(pb);
}

const MAC_SYMBOLS: Record<Modifier, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘', super: '⌘' };
const OTHER_NAMES: Record<Modifier, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', cmd: 'Super', super: 'Super' };
const MAC_KEYS: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→', Return: '↩', Esc: '⎋', Tab: '⇥', Backspace: '⌫', Delete: '⌦' };

/** "⌥⌘X" on macOS, "Ctrl+Alt+X" elsewhere; "Off" for ''. */
export function formatAccelerator(accelerator: string, mac: boolean): string {
  if (accelerator === '') return 'Off';
  const parsed = parse(accelerator, mac);
  if (!parsed) return accelerator;
  const mods = MODIFIER_ORDER.filter((m) => parsed.modifiers.has(m));
  if (mac) return mods.map((m) => MAC_SYMBOLS[m]).join('') + (MAC_KEYS[parsed.key] ?? parsed.key);
  return [...mods.map((m) => OTHER_NAMES[m]), parsed.key].join('+');
}
