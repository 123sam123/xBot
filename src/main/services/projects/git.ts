import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { join, sep } from 'node:path';
import type { FsAdapter } from './safeFs';

// Reads Git metadata from an approved folder without ever running code from
// it. A repository's own config can name programs Git will run (fsmonitor,
// hooks, textconv and external diff drivers, gpg for signatures, remote
// helpers for a partial clone's lazy fetch), so every call:
// - runs an absolute git binary with an argument array (no shell), an
//   environment built from scratch and `--git-dir` (no discovery);
// - overrides each of those settings on the command line, which beats the
//   repository's config, and sets GIT_ALLOW_PROTOCOL=none, the one control
//   that stops a repo-level `protocol.ext.allow=always` remote;
// - only reads: rev-parse, merge-base, log and show. Never status, a
//   working-tree diff, npm or a project script.
// tests/unit/projects-safety.test.ts arms a repository with each vector.

export type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Command-line config that overrides every repo setting able to run a program or change the output. */
export const GIT_CONFIG_ARGS: readonly string[] = [
  'core.fsmonitor=false',
  'core.hooksPath=/dev/null',
  'diff.external=',
  'log.showSignature=false',
  'log.mailmap=false',
  'core.pager=cat',
  'core.quotePath=off',
  'color.ui=false',
  'i18n.logOutputEncoding=UTF-8',
  'protocol.allow=never',
  'gpg.program=/usr/bin/false',
  'gpg.ssh.program=/usr/bin/false',
  'gpg.x509.program=/usr/bin/false',
].flatMap((setting) => ['-c', setting]);

/** Flags for every diff-producing command (`log --numstat`, `show`). */
export const DIFF_SAFETY: readonly string[] = ['--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--encoding=UTF-8', '--submodule=short'];

export function gitEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin',
    HOME: home,
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    // Overrides a repo's `protocol.<name>.allow`; `-c protocol.allow=never` alone does not.
    GIT_ALLOW_PROTOCOL: 'none',
    // Git 2.44+: never fetch a partial clone's missing objects.
    GIT_NO_LAZY_FETCH: '1',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_PAGER: 'cat',
  };
}

export interface GitResult {
  /** Exit code; null when git could not start or was killed. */
  code: number | null;
  stdout: string;
  truncated: boolean;
  timedOut: boolean;
}

export interface GitRunner {
  run(args: readonly string[], options: { timeoutMs: number; maxBytes?: number }): Promise<GitResult>;
}

const MAX_STDOUT = 512 * 1024;

export function createGitRunner({ binary, gitDir, cwd, home, spawn = nodeSpawn }: { binary: string; gitDir: string; cwd: string; home: string; spawn?: SpawnLike }): GitRunner {
  return {
    run(args, { timeoutMs, maxBytes = MAX_STDOUT }) {
      return new Promise<GitResult>((resolve) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        let timedOut = false;
        let child: ChildProcess;
        try {
          child = spawn(binary, [`--git-dir=${gitDir}`, '--no-pager', ...GIT_CONFIG_ARGS, ...args], {
            cwd,
            env: gitEnv(home),
            shell: false,
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
          });
        } catch {
          resolve({ code: null, stdout: '', truncated: false, timedOut: false });
          return;
        }
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, Math.max(1, timeoutMs));
        child.stdout?.on('data', (chunk: Buffer) => {
          if (truncated) return;
          if (size + chunk.length > maxBytes) {
            chunks.push(chunk.subarray(0, maxBytes - size));
            size = maxBytes;
            truncated = true;
            child.kill('SIGKILL');
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        let settled = false;
        const finish = (code: number | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ code: truncated || timedOut ? null : code, stdout: Buffer.concat(chunks).toString('utf8'), truncated, timedOut });
        };
        child.on('error', () => finish(null));
        child.on('close', (code) => finish(code));
      });
    },
  };
}

// ---------- Finding git ----------

export interface FindGitDeps {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
  /** True when `path` is an executable file. */
  isExecutable(path: string): boolean;
  spawn?: SpawnLike;
}

/** Exit code of `/usr/bin/xcode-select -p`: 0 when the Command Line Tools (or Xcode) are installed. */
function xcodeSelectOk(spawn: SpawnLike): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn('/usr/bin/xcode-select', ['-p'], { env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore', shell: false });
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.on('error', () => resolve(false));
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * The git binary, as an absolute path, never looked up on PATH (a relative or
 * in-project PATH entry could supply a fake `git`). On macOS `/usr/bin/git` is
 * a shim that opens the Command Line Tools installer when they are missing,
 * so it is used only when `xcode-select -p` says they are installed.
 */
export async function findGit({ platform, isPackaged, env, isExecutable, spawn = nodeSpawn }: FindGitDeps): Promise<string | null> {
  const override = !isPackaged ? env.XBOT_GIT_BINARY : undefined;
  if (override) return override.startsWith('/') && isExecutable(override) ? override : null;
  for (const candidate of ['/opt/homebrew/bin/git', '/usr/local/bin/git']) {
    if (isExecutable(candidate)) return candidate;
  }
  if (isExecutable('/usr/bin/git') && (platform !== 'darwin' || (await xcodeSelectOk(spawn)))) return '/usr/bin/git';
  if (platform !== 'darwin' && isExecutable('/bin/git')) return '/bin/git';
  return null;
}

// ---------- Is this a repository xBot may read? ----------

export type GitDirCheck = { ok: true; gitDir: string } | { ok: false; note: string | null };

const NOTES = {
  linked: 'Linked worktree or submodule: add the main checkout to read its Git history.',
  link: 'Its .git folder is a link, so xBot doesn’t read its Git history.',
  owner: 'Its Git data belongs to another user, so xBot doesn’t read its history.',
  outside: 'Its Git data points outside this folder, so xBot doesn’t read its history.',
  broken: 'Its .git folder isn’t a complete repository.',
} as const;

/**
 * Git only when `<root>/.git` is a real directory owned by this user whose
 * parts all live inside it. `--git-dir` skips Git's own ownership check, and
 * `commondir` or `objects/info/alternates` make `log` print another
 * repository's commits, so each is refused here. `note: null` means the
 * folder simply isn't a repository.
 */
export async function checkGitDir(root: string, fs: FsAdapter, uid: number | null): Promise<GitDirCheck> {
  const gitDir = join(root, '.git');
  let stat;
  try {
    stat = await fs.lstat(gitDir);
  } catch {
    return { ok: false, note: null };
  }
  if (stat.isFile()) return { ok: false, note: NOTES.linked };
  if (stat.isSymbolicLink()) return { ok: false, note: NOTES.link };
  if (!stat.isDirectory()) return { ok: false, note: null };
  if (uid !== null && stat.uid !== uid) return { ok: false, note: NOTES.owner };

  const exists = async (path: string) => {
    try {
      await fs.lstat(path);
      return true;
    } catch {
      return false;
    }
  };
  if ((await exists(join(gitDir, 'commondir'))) || (await exists(join(gitDir, 'objects', 'info', 'alternates')))) {
    return { ok: false, note: NOTES.outside };
  }
  for (const part of ['HEAD', 'objects', 'refs', 'config', 'packed-refs']) {
    const path = join(gitDir, part);
    let partStat;
    try {
      partStat = await fs.lstat(path);
    } catch {
      if (part === 'HEAD' || part === 'objects' || part === 'refs') return { ok: false, note: NOTES.broken };
      continue;
    }
    if (partStat.isSymbolicLink()) return { ok: false, note: NOTES.outside };
    try {
      const real = await fs.realpath(path);
      if (!real.startsWith(gitDir + sep)) return { ok: false, note: NOTES.outside };
    } catch {
      return { ok: false, note: NOTES.broken };
    }
  }
  return { ok: true, gitDir };
}

// ---------- Commits ----------

export interface CommitFile {
  path: string;
  /** Null for a binary file. */
  added: number | null;
  removed: number | null;
}

export interface CommitInfo {
  sha: string;
  author: string;
  /** Committer date, ISO 8601. */
  date: string;
  subject: string;
  files: CommitFile[];
}

const HEADER = /^\n?([0-9a-f]{40}(?:[0-9a-f]{24})?)\n([^\n]*)\n([^\n]*)\n([^\n]*)$/;
const NUMSTAT = /^\n?(\d+|-)\t(\d+|-)\t([\s\S]+)$/;
export const LOG_FORMAT = '--format=%H%n%an%n%cI%n%s';

/**
 * Parses `git log -z --numstat --format=%H%n%an%n%cI%n%s`. Output is split on
 * NUL: a commit header is four lines (a subject or author name can't hold a
 * newline, so it can't forge a record), a numstat entry starts with two counts
 * and a tab, and anything else is dropped.
 */
export function parseLog(stdout: string): CommitInfo[] {
  const commits: CommitInfo[] = [];
  let current: CommitInfo | null = null;
  for (const token of stdout.split('\0')) {
    if (token === '' || token === '\n') continue;
    const header = HEADER.exec(token);
    if (header) {
      current = { sha: header[1]!, author: header[2]!, date: header[3]!, subject: header[4]!, files: [] };
      commits.push(current);
      continue;
    }
    const stat = NUMSTAT.exec(token);
    if (stat && current) {
      current.files.push({ path: stat[3]!, added: stat[1] === '-' ? null : Number(stat[1]), removed: stat[2] === '-' ? null : Number(stat[2]) });
    }
  }
  return commits;
}

export interface ReadCommitsResult {
  head: string | null;
  commits: CommitInfo[];
  /** False when no `log` call completed untruncated: the checkpoint must not move. */
  finished: boolean;
  /** True when there was no usable checkpoint (first scan, rebase, branch switch, gc). */
  fromScratch: boolean;
}

export const COMMIT_LIMIT = 30;

/** The newest commits since `checkpoint` (at most 30), or the newest 30 when it is gone. */
export async function readCommits(git: GitRunner, checkpoint: string | null, timeLeft: () => number): Promise<ReadCommitsResult> {
  const timeout = () => Math.min(5000, timeLeft());
  const none = (finished: boolean, head: string | null = null, fromScratch = true): ReadCommitsResult => ({ head, commits: [], finished, fromScratch });

  if (timeLeft() <= 0) return none(false);
  const rev = await git.run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { timeoutMs: timeout(), maxBytes: 256 });
  if (rev.timedOut || rev.truncated) return none(false);
  const head = rev.code === 0 ? rev.stdout.trim() : '';
  // An empty repository (no commits yet) has nothing to read; that is a finished read.
  if (!SHA.test(head)) return none(rev.code !== null);
  if (checkpoint === head) return none(true, head, false);

  let range = 'HEAD';
  let fromScratch = true;
  if (checkpoint && SHA.test(checkpoint) && timeLeft() > 0) {
    // 0: an ancestor; 1, or 128 when the commit is gone after a gc: not one.
    const base = await git.run(['merge-base', '--is-ancestor', '--end-of-options', checkpoint, 'HEAD'], { timeoutMs: timeout(), maxBytes: 256 });
    if (base.timedOut) return none(false, head);
    if (base.code === 0) {
      range = `${checkpoint}..HEAD`;
      fromScratch = false;
    }
  }

  const logArgs = (numstat: boolean) => [
    'log',
    '-z',
    '--no-merges',
    ...(numstat ? ['--numstat'] : []),
    ...DIFF_SAFETY,
    '-n',
    String(COMMIT_LIMIT),
    LOG_FORMAT,
    '--end-of-options',
    range,
  ];
  for (const numstat of [true, false]) {
    if (timeLeft() <= 0) break;
    const result = await git.run(logArgs(numstat), { timeoutMs: timeout() });
    // A missing blob (partial clone) or one huge commit: try again without the stats.
    if (result.code !== 0) continue;
    return { head, commits: parseLog(result.stdout), finished: true, fromScratch };
  }
  return { head, commits: [], finished: false, fromScratch };
}

/** The diff of `sha` limited to `paths` (literal pathspecs; GIT_LITERAL_PATHSPECS is set). Null when it failed. */
export async function readDiff(git: GitRunner, sha: string, paths: readonly string[], timeoutMs: number): Promise<string | null> {
  if (!SHA.test(sha) || paths.length === 0 || timeoutMs <= 0) return null;
  const result = await git.run(['show', '--unified=1', '--format=', ...DIFF_SAFETY, '--end-of-options', sha, '--', ...paths], { timeoutMs: Math.min(5000, timeoutMs) });
  if (result.code !== 0 && !result.truncated) return null;
  return result.stdout;
}
