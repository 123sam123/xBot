import { constants, promises as fsp, type Dirent, type Stats } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

// Every read of an approved folder goes through here. Paths are relative to
// the folder's realpath and may not climb out of it; symlinked folders are
// never entered, and a file is opened only after its realpath is proven to
// sit inside the folder and the ignore rules have passed for every name it
// goes by. Electron-free, and the fs calls go through an adapter, so tests
// record every path that is listed or opened.

export interface FileHandleLike {
  stat(): Promise<Stats>;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface FsAdapter {
  lstat(path: string): Promise<Stats>;
  /** Canonical path (`realpath(3)`: macOS case and `/private` resolved). */
  realpath(path: string): Promise<string>;
  readdir(path: string): Promise<Dirent[]>;
  open(path: string, flags: number): Promise<FileHandleLike>;
}

export const nodeFs: FsAdapter = {
  lstat: (path) => fsp.lstat(path),
  realpath: (path) => fsp.realpath(path),
  readdir: (path) => fsp.readdir(path, { withFileTypes: true }),
  open: (path, flags) => fsp.open(path, flags),
};

export const LIMITS = {
  fileBytes: 256 * 1024,
  scanBytes: 2 * 1024 * 1024,
  entries: 2000,
  timeMs: 5000,
  /** Bytes checked for a NUL to call a file binary. */
  sniffBytes: 8 * 1024,
} as const;

/** A path that is not a plain relative path inside the folder. Thrown before any fs call. */
export class PathRefused extends Error {
  constructor(path: string) {
    super(`Refused path: ${JSON.stringify(path.slice(0, 200))}`);
    this.name = 'PathRefused';
  }
}

/** Normalises a relative path to `a/b/c`, refusing absolute paths, `..`, NUL and empty segments' tricks. */
export function checkRelative(path: string): string {
  if (typeof path !== 'string' || path === '' || path.includes('\0') || isAbsolute(path) || /^[a-zA-Z]:/.test(path)) {
    throw new PathRefused(String(path));
  }
  const parts = path.split(/[/\\]+/).filter((p) => p !== '' && p !== '.');
  if (parts.length === 0 || parts.some((p) => p === '..')) throw new PathRefused(path);
  return parts.join('/');
}

export type StopReason = 'time' | 'bytes' | 'entries';

/** One scan's limits: wall clock, bytes read and directory entries listed. */
export class ScanBudget {
  private readonly deadline: number;
  bytesLeft: number;
  entriesLeft: number;
  stopped: StopReason | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    limits: { timeMs?: number; bytes?: number; entries?: number } = {},
  ) {
    this.deadline = now() + (limits.timeMs ?? LIMITS.timeMs);
    this.bytesLeft = limits.bytes ?? LIMITS.scanBytes;
    this.entriesLeft = limits.entries ?? LIMITS.entries;
  }

  timeLeft(): number {
    return Math.max(0, this.deadline - this.now());
  }

  /** False (and stopped) once the clock ran out. */
  ok(): boolean {
    if (this.stopped) return false;
    if (this.timeLeft() <= 0) this.stopped = 'time';
    return this.stopped === null;
  }

  takeBytes(n: number): boolean {
    if (!this.ok()) return false;
    if (n > this.bytesLeft) {
      this.stopped = 'bytes';
      return false;
    }
    this.bytesLeft -= n;
    return true;
  }

  /** Takes up to `n` entries; returns how many may be used (fewer means the budget ran out). */
  takeEntries(n: number): number {
    if (!this.ok()) return 0;
    const granted = Math.min(n, this.entriesLeft);
    this.entriesLeft -= granted;
    if (granted < n) this.stopped = 'entries';
    return granted;
  }
}

export interface Entry {
  name: string;
  /** Relative to the folder, `/`-separated. */
  rel: string;
  kind: 'file' | 'dir' | 'symlink' | 'other';
}

export interface FileMeta {
  size: number;
  mtimeMs: number;
}

export type ReadResult =
  | { status: 'ok'; text: string; size: number; mtimeMs: number }
  | { status: 'excluded' | 'missing' | 'unreadable' | 'binary' | 'too_big' | 'budget' };

export interface SafeRoot {
  /** The folder's realpath. */
  readonly root: string;
  /** A directory's entries, or null when it can't be listed (or the budget ran out). Never follows a symlink. */
  list(relDir: string): Promise<Entry[] | null>;
  /** Size and mtime of a regular, non-symlinked file, without opening it. */
  meta(rel: string): Promise<FileMeta | null>;
  /**
   * Reads a text file. `exempt` skips the ignore rules for this one path (only
   * `.git/info/exclude`); `noSymlink` refuses a symlink outright (ignore files).
   */
  readText(rel: string, options?: { exempt?: boolean; noSymlink?: boolean }): Promise<ReadResult>;
}

export interface SafeRootOptions {
  root: string;
  fs?: FsAdapter;
  budget: ScanBudget;
  /** The ignore rules: true when `rel` (a file, or a directory when `isDir`) must not be read or listed. */
  isExcluded(rel: string, isDir: boolean): boolean;
}

const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
// Control characters other than tab and newline (a repo can carry terminal escapes).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

const toPosix = (path: string) => path.split(sep).join('/');

export function createSafeRoot({ root, fs = nodeFs, budget, isExcluded }: SafeRootOptions): SafeRoot {
  const inside = (real: string) => real.startsWith(root + sep);

  async function list(relDir: string): Promise<Entry[] | null> {
    const rel = relDir === '' ? '' : checkRelative(relDir);
    if (rel !== '' && isExcluded(rel, true)) return null;
    if (!budget.ok()) return null;
    const abs = rel === '' ? root : join(root, rel);
    try {
      const stat = await fs.lstat(abs);
      if (!stat.isDirectory()) return null;
      // A folder swapped for a symlink after it was listed resolves elsewhere.
      if ((await fs.realpath(abs)) !== abs) return null;
      const dirents = await fs.readdir(abs);
      const granted = budget.takeEntries(dirents.length);
      return dirents.slice(0, granted).map((d) => ({
        name: d.name,
        rel: rel === '' ? d.name : `${rel}/${d.name}`,
        kind: d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other',
      }));
    } catch {
      return null;
    }
  }

  async function meta(relPath: string): Promise<FileMeta | null> {
    const rel = checkRelative(relPath);
    if (isExcluded(rel, false) || !budget.ok()) return null;
    try {
      const abs = join(root, rel);
      const stat = await fs.lstat(abs);
      if (!stat.isFile() || (await fs.realpath(abs)) !== abs) return null;
      return { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }

  async function readText(relPath: string, options: { exempt?: boolean; noSymlink?: boolean } = {}): Promise<ReadResult> {
    const rel = checkRelative(relPath);
    if (!options.exempt && isExcluded(rel, false)) return { status: 'excluded' };
    if (!budget.ok()) return { status: 'budget' };
    const abs = join(root, rel);
    let handle: FileHandleLike | null = null;
    try {
      const link = await fs.lstat(abs);
      if (link.isSymbolicLink() && options.noSymlink) return { status: 'unreadable' };
      if (!link.isSymbolicLink() && !link.isFile()) return { status: 'unreadable' };
      // Every file, symlinked or not: a parent folder may have become a symlink since it was listed.
      const real = await fs.realpath(abs);
      if (!inside(real)) return { status: 'excluded' };
      if (real !== abs) {
        if (options.noSymlink) return { status: 'unreadable' };
        // The target is checked under its own name too: `docs/a.md -> ../.env` stays unread.
        if (isExcluded(toPosix(relative(root, real)), false)) return { status: 'excluded' };
      }
      const stat = await fs.lstat(real);
      if (!stat.isFile() || stat.nlink !== 1) return { status: 'unreadable' };
      // An iCloud placeholder: reading it would download the file.
      if (stat.blocks === 0 && stat.size > 0) return { status: 'unreadable' };
      if (stat.size > LIMITS.fileBytes) return { status: 'too_big' };
      if (!budget.takeBytes(stat.size)) return { status: 'budget' };

      handle = await fs.open(real, OPEN_FLAGS);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) return { status: 'unreadable' };
      const buffer = new Uint8Array(Math.min(stat.size, LIMITS.fileBytes));
      let filled = 0;
      while (filled < buffer.length) {
        const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      const bytes = buffer.subarray(0, filled);
      if (bytes.subarray(0, LIMITS.sniffBytes).includes(0)) return { status: 'binary' };
      const text = new TextDecoder('utf-8').decode(bytes).replace(CONTROL, '');
      return { status: 'ok', text, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return { status: code === 'ENOENT' ? 'missing' : 'unreadable' };
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  return { root, list, meta, readText };
}
