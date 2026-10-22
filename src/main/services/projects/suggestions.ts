import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { ideaCopy } from '../../../shared/ideaCopy';
import type { Idea, IdeaClaim, IdeaKind, IdeaSource, IdeasState, ProjectBrief, RefreshResult } from '../../../shared/contracts/projects';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import type { TaskRequest, TaskResult } from '../ai/service';
import { buildIdeaSources, checkIdeas, ideasTask, jaccard, normalizeText, type IdeaEvent, type IdeasSchema } from './ideas';

// The ideas list: when to ask the local model, what to send it, and what to
// keep. `auto` (the Ideas entry opening, T8's reminder) only uses activity
// no generation has used yet, so an unchanged history makes no AI call;
// `force` (an explicit "Refresh ideas" or a new note) uses the recent
// activity. One generation at a time: `auto` joins a running one, `force`
// replaces a background one. Electron-free; tests drive it with T6's
// service against a mock Ollama.

export type RefreshMode = 'auto' | 'force';
export type GenerateTask = <S extends z.ZodType>(req: TaskRequest<S>) => Promise<TaskResult<S>>;

export interface SuggestionsDeps {
  db: Db;
  log: Logger;
  isPreview: boolean;
  generate: GenerateTask;
  cancel(requestId: string): void;
  /** The user's banned phrases (T6's voice profile). */
  bannedPhrases(): string[];
  emit(state: IdeasState): void;
  now?(): number;
}

const SHOWN = 6;
const EVENTS_PER_RUN = 20;
const DISMISSED_COMPARED = 200;
const SIMILAR = 0.7;
/** Errors after which a background run must not repeat the same request every interval. */
const ATTEMPTED_ERRORS = new Set(['ai_malformed', 'ai_timeout', 'ai_input_too_long', 'ai_failed', 'ai_stopped']);

interface SuggestionRow {
  id: string;
  project_id: string | null;
  project_name: string | null;
  kind: IdeaKind;
  text: string;
  sources_json: string;
  claims_json: string;
  flags_json: string;
  created_at: string;
}

interface EventRow {
  id: string;
  project_id: string | null;
  kind: IdeaEvent['kind'];
  summary: string;
  source_ref: string;
  fingerprint: string;
  detail_json: string;
}

interface ScopeRow {
  scope: string;
}

interface ProjectRow {
  id: string;
  name: string;
  root_realpath: string;
  brief_json: string;
  summary_text: string | null;
}

interface Running {
  requestId: string;
  priority: 'interactive' | 'background';
  mode: RefreshMode;
  projectName: string | null;
  promise: Promise<RefreshResult>;
}

export type SuggestionsService = ReturnType<typeof createSuggestionsService>;

export function createSuggestionsService(deps: SuggestionsDeps) {
  const { db } = deps;
  const stamp = () => new Date(deps.now?.() ?? Date.now()).toISOString();
  let running: Running | null = null;
  let error: IdeasState['error'] = null;
  let askedForContext = false;
  let disposed = false;

  const q = {
    listNew: db.prepare<[], SuggestionRow>(
      `SELECT s.*, p.name AS project_name FROM suggestions s LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.status = 'new' ORDER BY s.created_at DESC, s.rowid DESC LIMIT 50`,
    ),
    byId: db.prepare<[string], { id: string; project_id: string | null; source_key: string; text: string; status: string }>(
      'SELECT id, project_id, source_key, text, status FROM suggestions WHERE id = ?',
    ),
    setStatus: db.prepare('UPDATE suggestions SET status = ?, updated_at = ? WHERE id = ?'),
    scopeAuto: db.prepare<[], ScopeRow>(
      `SELECT ifnull(project_id, '') AS scope FROM project_events
       WHERE generated_at IS NULL AND attempted_at IS NULL AND low_signal = 0
       GROUP BY ifnull(project_id, '') ORDER BY MAX(created_at) DESC LIMIT 1`,
    ),
    scopeForce: db.prepare<[], ScopeRow>(
      `SELECT ifnull(project_id, '') AS scope FROM project_events WHERE low_signal = 0
       GROUP BY ifnull(project_id, '') ORDER BY MAX(created_at) DESC LIMIT 1`,
    ),
    eventsAuto: db.prepare<[string, number], EventRow>(
      `SELECT * FROM project_events WHERE ifnull(project_id, '') = ? AND generated_at IS NULL AND attempted_at IS NULL AND low_signal = 0
       ORDER BY created_at DESC, occurred_at DESC LIMIT ?`,
    ),
    eventsForce: db.prepare<[string, number], EventRow>(
      `SELECT * FROM project_events WHERE ifnull(project_id, '') = ? AND low_signal = 0
       ORDER BY created_at DESC, occurred_at DESC LIMIT ?`,
    ),
    project: db.prepare<[string], ProjectRow>('SELECT id, name, root_realpath, brief_json, summary_text FROM projects WHERE id = ?'),
    markGenerated: db.prepare('UPDATE project_events SET generated_at = ? WHERE id = ?'),
    markAttempted: db.prepare('UPDATE project_events SET attempted_at = ? WHERE id = ?'),
    fingerprintExists: db.prepare<[string], { one: number }>('SELECT 1 AS one FROM suggestions WHERE fingerprint = ?'),
    dismissedKey: db.prepare<[string], { one: number }>('SELECT 1 AS one FROM dismissed_suggestions WHERE source_key = ?'),
    dismissedTexts: db.prepare<[string, number], { text_norm: string }>(
      'SELECT text_norm FROM dismissed_suggestions WHERE scope = ? ORDER BY created_at DESC LIMIT ?',
    ),
    insert: db.prepare(
      `INSERT INTO suggestions (id, project_id, kind, text, sources_json, claims_json, flags_json, source_key, fingerprint, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    ),
    insertDismissed: db.prepare('INSERT OR IGNORE INTO dismissed_suggestions (source_key, scope, text_norm, created_at) VALUES (?, ?, ?, ?)'),
    scopeOfProject: db.prepare<[string], { root_realpath: string }>('SELECT root_realpath FROM projects WHERE id = ?'),
  };

  function toIdea(row: SuggestionRow): Idea {
    return {
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      kind: row.kind,
      text: row.text,
      sources: JSON.parse(row.sources_json) as IdeaSource[],
      claims: JSON.parse(row.claims_json) as IdeaClaim[],
      flags: JSON.parse(row.flags_json) as Idea['flags'],
      createdAt: row.created_at,
    };
  }

  /** New ideas, best first: those with nothing to confirm, then the newest. */
  function ranked(): Idea[] {
    const ideas = q.listNew.all().map(toIdea);
    const open = (idea: Idea) => (idea.claims.some((c) => !c.confirmed) ? 1 : 0);
    return ideas.sort((a, b) => open(a) - open(b) || b.createdAt.localeCompare(a.createdAt));
  }

  function state(): IdeasState {
    // Preview mode lists what is stored: the seeded sample idea (T10). Refresh stays refused.
    const ideas = ranked().slice(0, SHOWN);
    return {
      ideas,
      running: running ? { requestId: running.requestId, priority: running.priority, projectName: running.projectName } : null,
      error,
      needsContext: askedForContext && ideas.length === 0,
      preview: deps.isPreview,
    };
  }

  const publish = () => {
    if (!disposed) deps.emit(state());
  };

  /** The dismissal scope of a project id ('' is the general scope). */
  const scopeKey = (projectId: string) => (projectId === '' ? 'general' : (q.scopeOfProject.get(projectId)?.root_realpath ?? `project:${projectId}`));

  function isDismissed(scope: string, sourceKey: string, textNorm: string): boolean {
    if (q.dismissedKey.get(sourceKey)) return true;
    return q.dismissedTexts.all(scope, DISMISSED_COMPARED).some((row) => jaccard(row.text_norm, textNorm) >= SIMILAR);
  }

  async function generate(mode: RefreshMode, priority: 'interactive' | 'background', requestId: string, scopeId: string): Promise<RefreshResult> {
    const rows = mode === 'auto' ? q.eventsAuto.all(scopeId, EVENTS_PER_RUN) : q.eventsForce.all(scopeId, EVENTS_PER_RUN);
    if (rows.length === 0) return noActivity();
    const project = scopeId === '' ? undefined : q.project.get(scopeId);
    const scope = scopeKey(scopeId);
    const brief = project ? (JSON.parse(project.brief_json) as ProjectBrief) : null;
    const events: IdeaEvent[] = rows.map((row) => {
      const detail = JSON.parse(row.detail_json) as { excerpt?: unknown };
      return {
        id: row.id,
        kind: row.kind,
        summary: row.summary,
        sourceRef: row.source_ref,
        fingerprint: row.fingerprint,
        ...(typeof detail.excerpt === 'string' ? { excerpt: detail.excerpt } : {}),
      };
    });
    const { sources, refs } = buildIdeaSources({ scope, brief, digest: project?.summary_text ?? null, events });

    let result: TaskResult<IdeasSchema>;
    try {
      result = await deps.generate({ requestId, priority, task: ideasTask(brief?.sharingRestrictions ?? ''), sources });
    } catch (err) {
      if (err instanceof IpcError) {
        if (ATTEMPTED_ERRORS.has(err.code)) {
          const at = stamp();
          db.transaction(() => rows.forEach((row) => q.markAttempted.run(at, row.id)))();
        }
        if (err.code !== 'ai_busy') error = { code: err.code, message: err.message };
      }
      throw err;
    }
    if (result.status === 'cancelled') return { status: 'cancelled' };

    const checked = checkIdeas(result.value.ideas, { scope, included: result.included, refs, banned: deps.bannedPhrases() });
    const at = stamp();
    let added = 0;
    db.transaction(() => {
      for (const idea of checked) {
        if (q.fingerprintExists.get(idea.fingerprint) || isDismissed(scope, idea.sourceKey, idea.textNorm)) continue;
        const sources: IdeaSource[] = idea.sources.map((s) => ({ kind: s.kind, label: s.label }));
        q.insert.run(
          randomUUID(),
          project?.id ?? null,
          idea.kind,
          idea.text,
          JSON.stringify(sources),
          JSON.stringify(idea.claims),
          JSON.stringify(idea.flags),
          idea.sourceKey,
          idea.fingerprint,
          at,
          at,
        );
        added += 1;
      }
      // Only what the model actually saw counts as used; the rest waits for the next run.
      const seen = new Set(result.included.map((s) => s.name));
      for (const [name, ref] of refs) if (ref.eventId && seen.has(name)) q.markGenerated.run(at, ref.eventId);
    })();
    error = null;
    askedForContext = ranked().length === 0;
    return { status: 'done', added };
  }

  function noActivity(): RefreshResult {
    if (ranked().length > 0) return { status: 'up_to_date' };
    askedForContext = true;
    return { status: 'needs_context' };
  }

  /** Asks for ideas. See the module comment for `auto` and `force`; `projectId` ('' for general notes) picks the scope for `force`. */
  async function refresh(mode: RefreshMode, priority: 'interactive' | 'background', projectId?: string): Promise<RefreshResult> {
    if (deps.isPreview) throw new IpcError('projects_preview', ideaCopy.preview);
    if (running) {
      if (mode === 'auto' || running.mode === 'force') return running.promise;
      // A force replaces a background auto run: cancel it and wait for it to settle.
      deps.cancel(running.requestId);
      await running.promise.catch(() => undefined);
      if (running) return running.promise;
    }
    const scope = projectId ?? (mode === 'auto' ? q.scopeAuto.get() : q.scopeForce.get())?.scope;
    if (scope === undefined) {
      const result = noActivity();
      publish();
      return result;
    }
    const requestId = randomUUID();
    const projectName = scope === '' ? null : (q.project.get(scope)?.name ?? null);
    const promise = generate(mode, priority, requestId, scope).finally(() => {
      if (running?.requestId === requestId) running = null;
      publish();
    });
    running = { requestId, priority, mode, projectName, promise };
    publish();
    return promise;
  }

  function setStatus(id: string, status: 'used' | 'dismissed'): IdeasState {
    const row = q.byId.get(id);
    if (!row) throw new IpcError('idea_not_found', 'That idea is no longer there.');
    db.transaction(() => {
      q.setStatus.run(status, stamp(), id);
      if (status === 'dismissed') q.insertDismissed.run(row.source_key, scopeKey(row.project_id ?? ''), normalizeText(row.text), stamp());
    })();
    publish();
    return state();
  }

  return {
    state,
    refresh,
    cancel(): void {
      if (running) deps.cancel(running.requestId);
    },
    use: (id: string) => setStatus(id, 'used'),
    dismiss: (id: string) => setStatus(id, 'dismissed'),
    /** For T8: the idea to show when a reminder fires, or null. */
    getTopRelevant(): Idea | null {
      return deps.isPreview ? null : (ranked()[0] ?? null);
    },
    /** A note or a new scan changed what there is to say. */
    activityChanged(): void {
      askedForContext = false;
      publish();
    },
    publish,
    dispose(): void {
      if (running) deps.cancel(running.requestId);
      disposed = true;
    },
  };
}

