import { randomUUID } from 'node:crypto';
import { basename, sep } from 'node:path';
import type { ProjectBrief, ProjectOptions, ProjectScanState, ProjectSummary } from '../../../shared/contracts/projects';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import { redact } from './redact';
import { nodeFs, type FsAdapter } from './safeFs';
import { cutBytes, scanFolder, type DocCache, type ScannerDeps } from './scanner';

// The approved folders: adding and removing them, their briefs, the user's
// notes, and scanning. Scans run one at a time across every folder, write
// their results in one transaction, and only ever add events (deduplicated
// by fingerprint), so a rescan of unchanged history adds nothing.
// Electron-free; index.ts wires the timers, the AI and the events.

export const STALE_MS = 15 * 60 * 1000;
const START_DELAY_MS = 5000;

const LAST_ACTIVITY = '(SELECT MAX(e.created_at) FROM project_events e WHERE e.project_id = p.id AND e.low_signal = 0) AS last_activity_at';

export const DEFAULT_OPTIONS: ProjectOptions = { readDocs: true, diffExcerpts: false };

export function defaultBrief(name: string): ProjectBrief {
  return { name, whatItDoes: '', whyBuilt: '', intendedUsers: '', stage: '', publicUrl: '', sharingRestrictions: '', confirmedFacts: [] };
}

export interface ProjectRow {
  id: string;
  root_path: string;
  root_realpath: string;
  name: string;
  brief_json: string;
  options_json: string;
  is_git: 0 | 1;
  scan_state: ProjectScanState;
  scan_note: string | null;
  last_scan_at: string | null;
  checkpoint_sha: string | null;
  summary_hash: string | null;
  summary_text: string | null;
  doc_cache_json: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
}

export interface ProjectsDeps {
  db: Db;
  log: Logger;
  isPreview: boolean;
  scanner: Omit<ScannerDeps, 'now' | 'fs'>;
  fs?: FsAdapter;
  home: string;
  now?(): number;
  /** The folder list or a scan state changed. */
  onChanged(projects: ProjectSummary[]): void;
  /** New activity was recorded (events from a scan, or a note). */
  onActivity?(): void;
}

export interface AddResult {
  added: ProjectSummary[];
  rejected: { name: string; reason: string }[];
}

export type ProjectsService = ReturnType<typeof createProjectsService>;

export function createProjectsService(deps: ProjectsDeps) {
  const { db } = deps;
  const fs = deps.fs ?? nodeFs;
  const now = () => deps.now?.() ?? Date.now();
  const stamp = () => new Date(now()).toISOString();
  const scanning = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;
  let timers: { start?: NodeJS.Timeout; interval?: NodeJS.Timeout } = {};

  const q = {
    all: db.prepare<[], ProjectRow>(`SELECT p.*, ${LAST_ACTIVITY} FROM projects p ORDER BY p.created_at, p.rowid`),
    byId: db.prepare<[string], ProjectRow>(`SELECT p.*, ${LAST_ACTIVITY} FROM projects p WHERE p.id = ?`),
    byReal: db.prepare<[string], { id: string }>('SELECT id FROM projects WHERE root_realpath = ?'),
    insert: db.prepare(
      `INSERT INTO projects (id, root_path, root_realpath, name, brief_json, options_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    remove: db.prepare('DELETE FROM projects WHERE id = ?'),
    saveBrief: db.prepare('UPDATE projects SET name = ?, brief_json = ?, options_json = ?, updated_at = ? WHERE id = ?'),
    scanFailed: db.prepare('UPDATE projects SET scan_state = ?, scan_note = ?, last_scan_at = ?, updated_at = ? WHERE id = ?'),
    scanDone: db.prepare(
      `UPDATE projects SET is_git = ?, scan_state = ?, scan_note = ?, last_scan_at = ?, doc_cache_json = ?, updated_at = ?,
         checkpoint_sha = CASE WHEN ? THEN ? ELSE checkpoint_sha END,
         summary_hash = CASE WHEN ? THEN ? ELSE summary_hash END,
         summary_text = CASE WHEN ? THEN ? ELSE summary_text END
       WHERE id = ?`,
    ),
    insertEvent: db.prepare(
      `INSERT OR IGNORE INTO project_events (id, project_id, kind, source_ref, summary, detail_json, inferred, low_signal, fingerprint, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    activitySince: db.prepare<[string], { one: number }>('SELECT 1 AS one FROM project_events WHERE low_signal = 0 AND created_at > ? LIMIT 1'),
  };

  const displayPath = (path: string) => (path === deps.home || path.startsWith(deps.home + sep) ? `~${path.slice(deps.home.length)}` : path);

  function toSummary(row: ProjectRow): ProjectSummary {
    return {
      id: row.id,
      name: row.name,
      displayPath: displayPath(row.root_path),
      isGit: row.is_git === 1,
      brief: JSON.parse(row.brief_json) as ProjectBrief,
      options: { ...DEFAULT_OPTIONS, ...(JSON.parse(row.options_json) as Partial<ProjectOptions>) },
      scan: { state: row.scan_state, at: row.last_scan_at, note: row.scan_note, scanning: scanning.has(row.id) },
      lastActivityAt: row.last_activity_at,
    };
  }

  const list = (): ProjectSummary[] => q.all.all().map(toSummary);
  const changed = () => {
    if (!disposed) deps.onChanged(list());
  };

  function row(id: string): ProjectRow {
    const found = q.byId.get(id);
    if (!found) throw new IpcError('project_not_found', 'That project is no longer there.');
    return found;
  }

  /** Scans one folder now (after any scan already running) and stores what it found. Resolves the number of new events. */
  async function scanOne(id: string): Promise<number> {
    const before = q.byId.get(id);
    if (!before || disposed || deps.isPreview) return 0;
    scanning.add(id);
    changed();
    try {
      const outcome = await scanFolder(
        {
          rootPath: before.root_path,
          rootReal: before.root_realpath,
          options: { ...DEFAULT_OPTIONS, ...(JSON.parse(before.options_json) as Partial<ProjectOptions>) },
          checkpoint: before.checkpoint_sha,
          lastScanAt: before.last_scan_at,
          summaryHash: before.summary_hash,
          docCache: JSON.parse(before.doc_cache_json) as DocCache,
        },
        { ...deps.scanner, fs, now },
      );
      // Quitting: the database closes right after dispose().
      if (disposed || !q.byId.get(id)) return 0;
      const at = stamp();
      if (outcome.state === 'missing' || outcome.state === 'denied' || outcome.state === 'error') {
        q.scanFailed.run(outcome.state, outcome.note, at, at, id);
        return 0;
      }
      let inserted = 0;
      db.transaction(() => {
        for (const event of outcome.events) {
          inserted += q.insertEvent.run(
            randomUUID(),
            id,
            event.kind,
            event.sourceRef,
            event.summary,
            JSON.stringify(event.detail),
            1,
            event.lowSignal ? 1 : 0,
            event.fingerprint,
            event.occurredAt,
            at,
          ).changes;
        }
        q.scanDone.run(
          outcome.isGit ? 1 : 0,
          outcome.state,
          outcome.note,
          at,
          JSON.stringify(outcome.docCache),
          at,
          outcome.checkpoint !== undefined ? 1 : 0,
          outcome.checkpoint ?? null,
          outcome.summary ? 1 : 0,
          outcome.summary?.hash ?? null,
          outcome.summary ? 1 : 0,
          outcome.summary?.text ?? null,
          id,
        );
      })();
      if (inserted > 0) deps.onActivity?.();
      return inserted;
    } catch (err) {
      deps.log.error(`projects: scan of ${id} failed`, err);
      if (!disposed && q.byId.get(id)) q.scanFailed.run('error', 'This folder couldn’t be read', stamp(), stamp(), id);
      return 0;
    } finally {
      scanning.delete(id);
      changed();
    }
  }

  /** Queues a scan behind every other one. */
  function scan(id: string): Promise<number> {
    const next = queue.then(() => scanOne(id));
    queue = next.catch(() => undefined);
    return next;
  }

  /** Background: every folder whose last scan is older than 15 min. A folder macOS denied waits for a manual Rescan. */
  async function scanStale(): Promise<void> {
    const cutoff = now() - STALE_MS;
    for (const project of q.all.all()) {
      if (project.scan_state === 'denied') continue;
      if (project.last_scan_at && Date.parse(project.last_scan_at) > cutoff) continue;
      await scan(project.id);
    }
  }

  return {
    list,
    get: (id: string) => toSummary(row(id)),
    /** Folder realpaths already approved (the picker warns about nesting). */
    approvedRoots: () => q.all.all().map((p) => ({ name: p.name, real: p.root_realpath })),

    /** Adds folders the user picked (the folder policy already passed) and scans each. */
    async add(paths: readonly string[]): Promise<AddResult> {
      if (deps.isPreview) throw new IpcError('projects_preview', 'Project folders are off in preview.');
      const result: AddResult = { added: [], rejected: [] };
      const ids: string[] = [];
      for (const path of paths) {
        const name = basename(path) || path;
        let real: string;
        try {
          real = await fs.realpath(path);
          if (!(await fs.lstat(real)).isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          const reason = code === 'EACCES' || code === 'EPERM' ? 'xBot isn’t allowed to read that folder.' : 'That folder no longer exists.';
          result.rejected.push({ name, reason });
          continue;
        }
        if (q.byReal.get(real)) {
          result.rejected.push({ name, reason: 'That folder is already added.' });
          continue;
        }
        const id = randomUUID();
        const at = stamp();
        const projectName = cutBytes(basename(real) || name, 80);
        q.insert.run(id, path, real, projectName, JSON.stringify(defaultBrief(projectName)), JSON.stringify(DEFAULT_OPTIONS), at, at);
        ids.push(id);
      }
      result.added = ids.map((id) => toSummary(row(id)));
      changed();
      for (const id of ids) void scan(id);
      return result;
    },

    remove(id: string): ProjectSummary[] {
      q.remove.run(id);
      changed();
      return list();
    },

    /** A scan the user asked for: always runs, whatever its age or state. */
    async rescan(id: string): Promise<ProjectSummary> {
      row(id);
      await scan(id);
      return toSummary(row(id));
    },

    scan,
    scanStale,
    /** Resolves when every queued scan has finished. */
    idle: () => queue,

    saveBrief(id: string, brief: ProjectBrief, options: ProjectOptions): ProjectSummary {
      const before = row(id);
      q.saveBrief.run(brief.name, JSON.stringify(brief), JSON.stringify(options), stamp(), id);
      const old = { ...DEFAULT_OPTIONS, ...(JSON.parse(before.options_json) as Partial<ProjectOptions>) };
      changed();
      // What is read changed: read it now rather than at the next stale scan.
      if (old.readDocs !== options.readDocs || old.diffExcerpts !== options.diffExcerpts) void scan(id);
      return toSummary(row(id));
    },

    /** "What did you build today?". The user's own words, so not inferred; redacted all the same. */
    addNote(projectId: string | null, text: string): void {
      if (deps.isPreview) throw new IpcError('projects_preview', 'Project folders are off in preview.');
      if (projectId !== null) row(projectId);
      const clean = redact(text.trim());
      const at = stamp();
      q.insertEvent.run(randomUUID(), projectId, 'note', cutBytes(clean, 200), `Note: ${clean}`, '{}', 0, 0, `note:${randomUUID()}`, at, at);
      deps.onActivity?.();
    },

    /** For T8: was useful activity recorded after `since` (ms or ISO)? Uses when xBot recorded it, never a commit's own date. */
    hasNewActivitySince(since: number | string): boolean {
      const ms = typeof since === 'number' ? since : Date.parse(since);
      // An unreadable time counts as "never": all recorded activity is new.
      return q.activitySince.get(new Date(Number.isFinite(ms) ? ms : 0).toISOString()) !== undefined;
    },

    /** Starts the background scans: stale folders shortly after launch, then every 15 min. */
    start(): void {
      if (deps.isPreview || disposed) return;
      timers.start = setTimeout(() => void scanStale(), START_DELAY_MS);
      timers.interval = setInterval(() => void scanStale(), STALE_MS);
      timers.start.unref?.();
      timers.interval.unref?.();
    },

    dispose(): void {
      disposed = true;
      clearTimeout(timers.start);
      clearInterval(timers.interval);
      timers = {};
    },
  };
}
