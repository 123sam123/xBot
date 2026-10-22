import { spawn, execFileSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Db } from '../../../src/main/db';
import type { Logger } from '../../../src/main/log';
import type { AiService } from '../../../src/main/services/ai/service';
import { nodeFs, type FsAdapter } from '../../../src/main/services/projects/safeFs';
import { createProjectsService } from '../../../src/main/services/projects/service';
import { createSuggestionsService } from '../../../src/main/services/projects/suggestions';

// Fixture folders built at test time (nothing secret-shaped is committed),
// an fs adapter and a spawn that record every call, and the projects and
// suggestions services wired to T6's AI service from mockOllama.ts.

export const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const dirs: string[] = [];

/** A fresh temp folder (realpath), removed by `cleanupFixtures()`. */
export function tempDir(prefix = 'xbot-proj-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

export function cleanupFixtures(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Writes `files` (relative path → content) under `root`. */
export function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

export function writeScript(path: string, body: string): string {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** The system git, by absolute path. Missing git fails the test rather than skipping it. */
export function gitBinary(): string {
  for (const candidate of ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git', '/bin/git']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error('git is required for these tests');
}

/** Runs git for fixture setup: no global or system config, no hooks, a fixed identity. */
export function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(gitBinary(), ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    env: { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Runs git the way a user would, without xBot's hardening (positive controls). Errors are ignored. */
export function plainGit(cwd: string, args: readonly string[]): void {
  try {
    execFileSync(gitBinary(), args, { cwd, env: { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: 'ignore', timeout: 10_000 });
  } catch {
    // a trap that fires may also make git fail; only the marker matters
  }
}

export function commitAll(cwd: string, subject: string): void {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '--allow-empty', '-m', subject]);
}

export interface FsCall {
  op: 'lstat' | 'realpath' | 'readdir' | 'open';
  path: string;
}

/** The real fs, recording every call. "Read" means `open`: the only call that touches a file's contents. */
export function recordingFs(): { fs: FsAdapter; calls: FsCall[] } {
  const calls: FsCall[] = [];
  const fs: FsAdapter = {
    lstat: (path) => (calls.push({ op: 'lstat', path }), nodeFs.lstat(path)),
    realpath: (path) => (calls.push({ op: 'realpath', path }), nodeFs.realpath(path)),
    readdir: (path) => (calls.push({ op: 'readdir', path }), nodeFs.readdir(path)),
    open: (path, flags) => (calls.push({ op: 'open', path }), nodeFs.open(path, flags)),
  };
  return { fs, calls };
}

/** The real spawn, recording each command's arguments. */
export function recordingSpawn(): { spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    spawn: (command, args, options) => {
      calls.push([command, ...args]);
      return spawn(command, [...args], options);
    },
  };
}

/** The git subcommand of a recorded spawn (the first argument after the `-c` pairs and global flags). */
export function subcommand(call: readonly string[]): string | undefined {
  for (let i = 1; i < call.length; i += 1) {
    const arg = call[i]!;
    if (arg === '-c') {
      i += 1;
      continue;
    }
    if (!arg.startsWith('-')) return arg;
  }
  return undefined;
}

/** The projects and suggestions services over T6's AI service (and its database). */
export function makeProjects(ai: AiService, db: Db, options: { fs?: FsAdapter; spawn?: ReturnType<typeof recordingSpawn>['spawn']; banned?: string[] } = {}) {
  const home = tempDir('xbot-home-');
  const ideas = createSuggestionsService({
    db,
    log: quiet,
    isPreview: false,
    generate: (req) => ai.generateTask(req),
    cancel: (requestId) => ai.cancel(requestId),
    bannedPhrases: () => options.banned ?? [],
    emit: () => {},
  });
  const projects = createProjectsService({
    db,
    log: quiet,
    isPreview: false,
    home,
    fs: options.fs,
    scanner: { findGit: async () => gitBinary(), uid: typeof process.getuid === 'function' ? process.getuid() : null, home, spawn: options.spawn },
    onChanged: () => {},
    onActivity: () => ideas.activityChanged(),
  });
  return { projects, ideas };
}

/** Adds a folder and waits for its first scan; returns the project id. */
export async function addAndScan(projects: ReturnType<typeof makeProjects>['projects'], dir: string): Promise<string> {
  const { added } = await projects.add([dir]);
  await projects.idle();
  const id = added[0]?.id;
  if (!id) throw new Error(`folder was not added: ${dir}`);
  return id;
}

export interface EventRow {
  kind: string;
  summary: string;
  source_ref: string;
  fingerprint: string;
  low_signal: number;
}

export function events(db: Db, projectId?: string): EventRow[] {
  const columns = 'SELECT kind, summary, source_ref, fingerprint, low_signal FROM project_events';
  return (projectId ? db.prepare(`${columns} WHERE project_id = ? ORDER BY rowid`).all(projectId) : db.prepare(`${columns} ORDER BY rowid`).all()) as EventRow[];
}
