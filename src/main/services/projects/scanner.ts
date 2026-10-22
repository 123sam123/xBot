import { createHash } from 'node:crypto';
import type { ProjectOptions, ProjectScanState } from '../../../shared/contracts/projects';
import { checkGitDir, createGitRunner, readCommits, readDiff, type CommitInfo, type SpawnLike } from './git';
import { createIgnoreRules, type IgnoreRules } from './ignoreRules';
import { redact } from './redact';
import { createSafeRoot, nodeFs, ScanBudget, type Entry, type FsAdapter, type SafeRoot } from './safeFs';

// One scan of one approved folder: Git metadata first (with its own share
// of the time budget, so a slow docs walk can't keep the checkpoint from
// moving), then README, docs and manifests, then, for a folder without Git,
// the names of recently changed files. Pure apart from the fs adapter and
// the git spawn: it returns what changed and the service persists it.

export const DAY_MS = 24 * 60 * 60 * 1000;
/** On a first scan (or after a rebase) only this much history becomes events. */
export const FRESH_WINDOW_MS = 7 * DAY_MS;
const GIT_SHARE_MS = 3000;
const MAX_DOCS = 12;
const DOC_DEPTH = 3;
const WALK_DEPTH = 8;
const EVENT_BYTES = 600;
const EXCERPT_BYTES = 2048;
const DIGEST_BYTES = 1536;
const MANIFEST_BYTES = 4096;
const MAX_FILES_LISTED = 20;
const MAX_COMMIT_FILES_SHOWN = 8;
const DIFF_COMMITS = 3;

const README = /^readme(?:\.(?:md|mdx|markdown|txt|rst))?$/i;
const CHANGELOG = /^(?:changelog|changes|history)(?:\.(?:md|mdx|markdown|txt|rst))?$/i;
const DOC_EXT = /\.(?:md|mdx|markdown|txt|rst)$/i;
const SOURCE_EXT = /\.(?:md|mdx|markdown|txt|rst|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|swift|kt|java|c|cc|cpp|h|hpp|cs|php|html|css|scss|vue|svelte)$/i;
const MANIFESTS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'] as const;

/** Commits that say nothing worth posting about: merges, bumps, typo fixes, bots. */
export const LOW_SIGNAL =
  /^(?:merge\b|wip\b|bump\b|chore\(deps?\)|update (?:deps|dependencies|lockfile)|fix(?:ed)? typo|typo|format(?:ting)?\b|lint\b|prettier\b|initial commit$|\W*$)/i;

export interface DocCacheEntry {
  size: number;
  mtimeMs: number;
  sha: string;
  /** README only: its excerpt for the digest, so an unchanged README is never re-read. */
  excerpt?: string;
}
export type DocCache = Record<string, DocCacheEntry>;

export interface NewEvent {
  kind: 'commit' | 'doc' | 'files';
  /** What "Why this suggestion?" shows: a commit subject, a doc path, file names. Redacted. */
  sourceRef: string;
  /** What the model reads. Redacted; no SHAs, dates, author names or absolute paths. */
  summary: string;
  detail: Record<string, unknown>;
  lowSignal: boolean;
  fingerprint: string;
  occurredAt: string;
}

export interface ScanInput {
  rootPath: string;
  rootReal: string;
  options: ProjectOptions;
  checkpoint: string | null;
  lastScanAt: string | null;
  summaryHash: string | null;
  docCache: DocCache;
}

export interface ScanOutcome {
  state: Exclude<ProjectScanState, 'never'>;
  note: string | null;
  isGit: boolean;
  events: NewEvent[];
  /** The new checkpoint; undefined leaves the stored one. */
  checkpoint?: string | null;
  /** A rebuilt digest; null when its inputs are unchanged. */
  summary: { hash: string; text: string } | null;
  docCache: DocCache;
}

export interface ScannerDeps {
  fs?: FsAdapter;
  now(): number;
  /** The git binary, or null when there is none. */
  findGit(): Promise<string | null>;
  spawn?: SpawnLike;
  /** The current user's uid (null where there is none): a repo owned by someone else isn't read. */
  uid: number | null;
  home: string;
  /** Overrides the 5 s budget (tests). */
  timeMs?: number;
}

const encoder = new TextEncoder();
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Cuts to at most `max` UTF-8 bytes on a character boundary. Always cut text that was already redacted. */
export function cutBytes(text: string, max: number): string {
  if (encoder.encode(text).length <= max) return text;
  let used = 0;
  let out = '';
  for (const ch of text) {
    const size = encoder.encode(ch).length;
    if (used + size > max - 3) break;
    used += size;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The first heading and the first paragraph of a markdown or text doc, without badges, HTML or code. */
export function docGist(text: string): { heading: string; paragraph: string } {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const lines = cleaned.split('\n');
  let heading = '';
  const paragraph: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const h = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (h) {
      if (!heading && paragraph.length === 0) {
        heading = oneLine(h[1]!);
        continue;
      }
      if (paragraph.length > 0) break;
      continue;
    }
    if (trimmed === '' || /^[=-]{3,}$/.test(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  return { heading, paragraph: oneLine(paragraph.join(' ')) };
}

/** The newest section of a changelog: from its first `##` heading to the next. */
function changelogTop(text: string): string {
  const match = /^#{2,3}\s+.*$/m.exec(text);
  if (!match) return docGist(text).paragraph;
  const rest = text.slice(match.index);
  const next = rest.slice(match[0].length).search(/^#{1,3}\s+/m);
  return oneLine(next >= 0 ? rest.slice(0, match[0].length + next) : rest);
}

function manifestText(name: string, text: string): string {
  if (name === 'package.json') {
    try {
      const pkg = JSON.parse(text) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v : '');
      const deps = [pkg.dependencies, pkg.devDependencies]
        .flatMap((d) => (d && typeof d === 'object' ? Object.keys(d) : []))
        .slice(0, 15);
      const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.filter((k): k is string => typeof k === 'string').slice(0, 10) : [];
      return [
        `package.json: ${str(pkg.name)}`,
        str(pkg.description) && `description: ${str(pkg.description)}`,
        keywords.length > 0 && `keywords: ${keywords.join(', ')}`,
        deps.length > 0 && `uses: ${deps.join(', ')}`,
      ]
        .filter(Boolean)
        .join('\n');
    } catch {
      return '';
    }
  }
  return `${name}:\n${text}`;
}

const isoOr = (value: string, fallback: number) => (Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : new Date(fallback).toISOString());

function localDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function errorState(err: unknown): { state: 'missing' | 'denied' | 'error'; note: string } {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'missing', note: 'Folder missing' };
  if (code === 'EACCES' || code === 'EPERM') return { state: 'denied', note: 'xBot isn’t allowed to read this folder' };
  return { state: 'error', note: 'This folder couldn’t be read' };
}

/** Loads an ignore file into `rules`; one that exists but can't be read excludes its folder's subtree. */
async function loadIgnoreFile(safe: SafeRoot, rules: IgnoreRules, dir: string, rel: string, exempt = false): Promise<void> {
  const result = await safe.readText(rel, { noSymlink: true, exempt });
  if (result.status === 'ok') rules.add(dir, result.text);
  else if (result.status !== 'missing') rules.excludeDir(dir);
}

/** Lists a folder after loading its own .gitignore. */
async function listWithRules(safe: SafeRoot, rules: IgnoreRules, dir: string): Promise<Entry[] | null> {
  const entries = await safe.list(dir);
  if (!entries) return null;
  if (dir !== '' && entries.some((e) => e.name === '.gitignore')) await loadIgnoreFile(safe, rules, dir, `${dir}/.gitignore`);
  return entries;
}

function commitEvent(commit: CommitInfo, rules: IgnoreRules, now: number): NewEvent {
  const allowed = commit.files.filter((f) => !rules.isExcluded(f.path, false));
  const hidden = commit.files.length - allowed.length;
  const shown = allowed.slice(0, MAX_COMMIT_FILES_SHOWN).map((f) => (f.added === null ? f.path : `${f.path} (+${f.added} −${f.removed ?? 0})`));
  const more = allowed.length - shown.length;
  const files = [
    ...shown,
    ...(more > 0 ? [`+${more} more`] : []),
    ...(hidden > 0 ? [`+${hidden} private file${hidden === 1 ? '' : 's'}`] : []),
  ];
  const subject = redact(commit.subject);
  return {
    kind: 'commit',
    sourceRef: cutBytes(subject, 200),
    summary: cutBytes(redact(`Commit: ${commit.subject}${files.length > 0 ? ` — files: ${files.join(', ')}` : ''}`), EVENT_BYTES),
    detail: { files: allowed.slice(0, MAX_FILES_LISTED).map((f) => redact(f.path)), hidden, paths: allowed.map((f) => f.path) },
    lowSignal: LOW_SIGNAL.test(commit.subject.trim()) || /\[bot\]/i.test(commit.author),
    fingerprint: `commit:${commit.sha}`,
    occurredAt: isoOr(commit.date, now),
  };
}

/** Scans one folder. Never throws for folder problems: they come back as the state. */
export async function scanFolder(input: ScanInput, deps: ScannerDeps): Promise<ScanOutcome> {
  const fs = deps.fs ?? nodeFs;
  const now = deps.now();
  const base: Omit<ScanOutcome, 'state' | 'note'> = { isGit: false, events: [], summary: null, docCache: input.docCache };

  // The folder must still be the one the user approved.
  try {
    const real = await fs.realpath(input.rootPath);
    const stat = await fs.lstat(real);
    if (real !== input.rootReal || !stat.isDirectory()) return { ...base, state: 'missing', note: 'Folder missing' };
  } catch (err) {
    return { ...base, ...errorState(err) };
  }

  const budget = new ScanBudget(deps.now, { timeMs: deps.timeMs });
  const rules = createIgnoreRules();
  const safe = createSafeRoot({ root: input.rootReal, fs, budget, isExcluded: rules.isExcluded });
  const events: NewEvent[] = [];
  const notes: string[] = [];
  let checkpoint: string | null | undefined;
  let gitFinished = true;

  await loadIgnoreFile(safe, rules, '', '.gitignore');
  await loadIgnoreFile(safe, rules, '', '.xbotignore');

  // ---------- Git ----------
  const gitCheck = await checkGitDir(input.rootReal, fs, deps.uid);
  let isGit = false;
  if (gitCheck.ok) {
    const binary = await deps.findGit();
    if (!binary) {
      notes.push('Git isn’t installed, so only docs and file names are read.');
    } else {
      isGit = true;
      await loadIgnoreFile(safe, rules, '', '.git/info/exclude', true);
      const git = createGitRunner({ binary, gitDir: gitCheck.gitDir, cwd: input.rootReal, home: deps.home, spawn: deps.spawn });
      const gitDeadline = deps.now() + Math.min(GIT_SHARE_MS, budget.timeLeft());
      const gitTimeLeft = () => Math.max(0, Math.min(gitDeadline - deps.now(), budget.timeLeft()));
      const read = await readCommits(git, input.checkpoint, gitTimeLeft);
      gitFinished = read.finished;
      if (read.finished) checkpoint = read.head;
      const fresh = read.fromScratch ? read.commits.filter((c) => Date.parse(c.date) >= now - FRESH_WINDOW_MS) : read.commits;
      const commitEvents = fresh.map((c) => commitEvent(c, rules, now));
      if (input.options.diffExcerpts) {
        for (const [index, event] of commitEvents.entries()) {
          if (index >= DIFF_COMMITS || event.lowSignal) continue;
          const paths = (event.detail.paths as string[]).slice(0, 50);
          const diff = await readDiff(git, fresh[index]!.sha, paths, gitTimeLeft());
          // Redacted whole, then cut: a cut must never leave half a secret behind.
          if (diff) event.detail.excerpt = cutBytes(redact(diff), EXCERPT_BYTES);
        }
      }
      for (const event of commitEvents) delete event.detail.paths;
      events.push(...commitEvents);
    }
  } else if (gitCheck.note) {
    notes.push(gitCheck.note);
  }

  // ---------- README, changelog, docs and manifests ----------
  const docCache: DocCache = {};
  const rootEntries = (await safe.list('')) ?? [];
  const files = rootEntries.filter((e) => e.kind === 'file' || e.kind === 'symlink');
  const readme = files.find((e) => README.test(e.name));
  const candidates: Entry[] = [];
  if (input.options.readDocs) {
    candidates.push(...files.filter((e) => CHANGELOG.test(e.name) || (e !== readme && DOC_EXT.test(e.name) && !README.test(e.name))));
    const queue: { dir: string; depth: number }[] = rootEntries
      .filter((e) => e.kind === 'dir' && /^docs?$/i.test(e.name))
      .map((e) => ({ dir: e.rel, depth: 1 }));
    while (queue.length > 0 && budget.ok()) {
      const { dir, depth } = queue.shift()!;
      const entries = await listWithRules(safe, rules, dir);
      if (!entries) continue;
      for (const entry of entries) {
        if (entry.kind === 'dir' && depth < DOC_DEPTH && !rules.isExcluded(entry.rel, true)) queue.push({ dir: entry.rel, depth: depth + 1 });
        else if ((entry.kind === 'file' || entry.kind === 'symlink') && DOC_EXT.test(entry.name)) candidates.push(entry);
      }
    }
  }
  const withMeta = await Promise.all(
    candidates.filter((e) => !rules.isExcluded(e.rel, false)).map(async (entry) => ({ entry, meta: await safe.meta(entry.rel) })),
  );
  const chosen = [
    ...(readme ? [readme] : []),
    ...withMeta
      .filter((c) => c.meta !== null)
      .sort((a, b) => b.meta!.mtimeMs - a.meta!.mtimeMs)
      .map((c) => c.entry),
  ].slice(0, MAX_DOCS);

  let readmeExcerpt = '';
  for (const entry of chosen) {
    if (!budget.ok()) break;
    const isReadme = entry === readme;
    const cached = input.docCache[entry.rel];
    const meta = await safe.meta(entry.rel);
    if (cached && meta && cached.size === meta.size && cached.mtimeMs === meta.mtimeMs) {
      docCache[entry.rel] = cached;
      if (isReadme) readmeExcerpt = cached.excerpt ?? '';
      continue;
    }
    const result = await safe.readText(entry.rel);
    if (result.status !== 'ok') continue;
    const sha = sha256(result.text);
    const text = redact(result.text);
    const gist = docGist(text);
    if (isReadme) readmeExcerpt = cutBytes([gist.heading, gist.paragraph].filter(Boolean).join('\n') || oneLine(text), DIGEST_BYTES);
    docCache[entry.rel] = { size: result.size, mtimeMs: result.mtimeMs, sha, ...(isReadme ? { excerpt: readmeExcerpt } : {}) };
    if (cached?.sha === sha) continue;
    const body = CHANGELOG.test(entry.name) ? changelogTop(text) : [gist.heading, gist.paragraph].filter(Boolean).join(' — ');
    if (body.trim() === '') continue;
    const label = isReadme ? 'README' : CHANGELOG.test(entry.name) ? 'Changelog' : 'Doc';
    events.push({
      kind: 'doc',
      sourceRef: redact(entry.rel),
      summary: cutBytes(`${label} ${redact(entry.rel)}${cached ? ' (updated)' : ''}: ${body}`, EVENT_BYTES),
      detail: { path: redact(entry.rel), updated: cached !== undefined },
      lowSignal: false,
      fingerprint: `doc:${entry.rel}:${sha}`,
      occurredAt: new Date(result.mtimeMs).toISOString(),
    });
  }

  const manifests: string[] = [];
  for (const name of MANIFESTS) {
    if (!files.some((e) => e.name === name) || !budget.ok()) continue;
    const result = await safe.readText(name);
    if (result.status === 'ok') {
      const text = manifestText(name, redact(result.text));
      if (text) manifests.push(cutBytes(text, MANIFEST_BYTES));
    }
  }

  // ---------- Recently changed files (no Git) ----------
  if (!isGit) {
    const since = input.lastScanAt ? Date.parse(input.lastScanAt) : now - FRESH_WINDOW_MS;
    const changed: { rel: string; mtimeMs: number }[] = [];
    const queue: { dir: string; depth: number }[] = [{ dir: '', depth: 0 }];
    while (queue.length > 0 && budget.ok()) {
      const { dir, depth } = queue.shift()!;
      const entries = dir === '' ? rootEntries : await listWithRules(safe, rules, dir);
      if (!entries) continue;
      for (const entry of entries) {
        if (entry.kind === 'dir') {
          if (depth < WALK_DEPTH && !rules.isExcluded(entry.rel, true)) queue.push({ dir: entry.rel, depth: depth + 1 });
        } else if (entry.kind === 'file' && SOURCE_EXT.test(entry.name) && !rules.isExcluded(entry.rel, false)) {
          const meta = await safe.meta(entry.rel);
          if (meta && meta.mtimeMs > since) changed.push({ rel: entry.rel, mtimeMs: meta.mtimeMs });
        }
      }
    }
    if (changed.length > 0) {
      changed.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const names = changed.slice(0, MAX_FILES_LISTED).map((c) => redact(c.rel));
      const more = changed.length - names.length;
      const list = `${names.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`;
      events.push({
        kind: 'files',
        sourceRef: cutBytes(list, 200),
        summary: cutBytes(`Files changed: ${list}`, EVENT_BYTES),
        detail: { files: names, more },
        lowSignal: false,
        // At most one a day: editor saves would otherwise count as new activity all day long.
        fingerprint: `files:${localDate(now)}`,
        occurredAt: new Date(changed[0]!.mtimeMs).toISOString(),
      });
    }
  }

  // ---------- Digest (repo-derived: README excerpt and manifests) ----------
  const digestText = [readmeExcerpt, ...manifests].filter(Boolean).join('\n\n');
  const digestHash = sha256(digestText);
  const summary = digestHash === input.summaryHash ? null : { hash: digestHash, text: cutBytes(digestText, DIGEST_BYTES * 2) };

  if (budget.stopped) notes.push(`Partial scan: the ${budget.stopped === 'time' ? 'time' : budget.stopped === 'bytes' ? 'reading' : 'file count'} limit was reached.`);
  else if (!gitFinished) notes.push('Partial scan: Git history couldn’t be read in time.');
  const partial = budget.stopped !== null || !gitFinished;
  return {
    state: partial ? 'partial' : 'ok',
    note: notes.length > 0 ? notes.join(' ') : null,
    isGit,
    events,
    checkpoint,
    summary,
    docCache,
  };
}
