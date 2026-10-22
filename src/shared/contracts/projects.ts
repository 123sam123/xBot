// Owned by T7 (XBOT-5UVE6R). Project context: the folders the user approved,
// their editable briefs, manual notes, and the story ideas found in them.
// The design is in ARCHITECTURE.md → "Project context".
import { z } from 'zod';
import type { SettingsShape } from './define';
import type { IpcResult } from './ipc';

/** SPEC §12's kinds of story, in the order the Ideas list explains them. */
export const IDEA_KINDS = ['problem_solved', 'feature_finished', 'before_after', 'bug_fix', 'funny_failure', 'lesson', 'demo', 'question'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

export const BRIEF_LIMITS = {
  name: 80,
  whatItDoes: 500,
  whyBuilt: 500,
  intendedUsers: 200,
  stage: 80,
  publicUrl: 300,
  sharingRestrictions: 500,
  facts: 20,
  fact: 200,
} as const;

export const NOTE_MAX = 500;

/** What the user says about a project. Everything here is theirs, so it counts as confirmed. */
export interface ProjectBrief {
  name: string;
  whatItDoes: string;
  whyBuilt: string;
  intendedUsers: string;
  stage: string;
  publicUrl: string;
  /** Rules for what may be said in public ("don't name the client"). */
  sharingRestrictions: string;
  confirmedFacts: string[];
}

export interface ProjectOptions {
  /** Read README is always on; this adds the changelog and docs/. */
  readDocs: boolean;
  /** Short, redacted diff excerpts of the newest commits. Off by default. */
  diffExcerpts: boolean;
}

export type ProjectScanState = 'never' | 'ok' | 'partial' | 'missing' | 'denied' | 'error';

export interface ProjectSummary {
  id: string;
  name: string;
  /** Where the folder is, for display (with `~` for the home folder). */
  displayPath: string;
  isGit: boolean;
  brief: ProjectBrief;
  options: ProjectOptions;
  scan: { state: ProjectScanState; at: string | null; note: string | null; scanning: boolean };
}

export type IdeaSourceKind = 'commit' | 'doc' | 'files' | 'note' | 'brief' | 'fact';

/** One item an idea is based on, as "Why this suggestion?" shows it. */
export interface IdeaSource {
  kind: IdeaSourceKind;
  label: string;
}

export interface IdeaClaim {
  text: string;
  /** True only when one of the user's own notes or confirmed facts says it. */
  confirmed: boolean;
  /** Why it needs confirming, when xBot added it. */
  reason: string | null;
}

export interface Idea {
  id: string;
  projectId: string | null;
  projectName: string | null;
  kind: IdeaKind;
  text: string;
  sources: IdeaSource[];
  claims: IdeaClaim[];
  flags: { phrases: string[]; hashtagsStripped: string[] };
  createdAt: string;
}

export type RefreshResult =
  /** A generation ran; `added` new ideas survived the checks. */
  | { status: 'done'; added: number }
  /** Nothing new since the last generation; the existing ideas stand. */
  | { status: 'up_to_date' }
  /** No useful activity and no idea to show: ask for one sentence. */
  | { status: 'needs_context' }
  | { status: 'cancelled' };

export interface IdeasState {
  /** New ideas, best first. */
  ideas: Idea[];
  running: { requestId: string; priority: 'interactive' | 'background'; projectName: string | null } | null;
  /** The last generation's failure (T6's codes and wording), cleared by the next success. */
  error: { code: string; message: string } | null;
  /** The last refresh found nothing to go on. */
  needsContext: boolean;
  preview: boolean;
}

export interface PickResult {
  projects: ProjectSummary[];
  added: string[];
  rejected: { name: string; reason: string }[];
  notes: string[];
}

const briefText = (max: number) => z.string().trim().max(max);

export const briefSchema = z.strictObject({
  name: z.string().trim().min(1).max(BRIEF_LIMITS.name),
  whatItDoes: briefText(BRIEF_LIMITS.whatItDoes),
  whyBuilt: briefText(BRIEF_LIMITS.whyBuilt),
  intendedUsers: briefText(BRIEF_LIMITS.intendedUsers),
  stage: briefText(BRIEF_LIMITS.stage),
  publicUrl: z.union([z.literal(''), z.string().trim().max(BRIEF_LIMITS.publicUrl).regex(/^https?:\/\/\S+$/i)]),
  sharingRestrictions: briefText(BRIEF_LIMITS.sharingRestrictions),
  confirmedFacts: z.array(z.string().trim().min(1).max(BRIEF_LIMITS.fact)).max(BRIEF_LIMITS.facts),
});

export const optionsSchema = z.strictObject({ readDocs: z.boolean(), diffExcerpts: z.boolean() });

export const projectIdSchema = z.strictObject({ id: z.uuid() });
export const saveBriefSchema = z.strictObject({ id: z.uuid(), brief: briefSchema, options: optionsSchema });
export const addNoteSchema = z.strictObject({ projectId: z.uuid().nullable(), text: z.string().trim().min(1).max(NOTE_MAX) });
export const refreshIdeasSchema = z.strictObject({ mode: z.enum(['auto', 'force']) });
export const ideaIdSchema = z.strictObject({ id: z.uuid() });

export const projectsSettings = {} satisfies SettingsShape;

export interface ProjectsEvents {
  /** The folder list or a folder's scan state changed. */
  'projects:changed': { projects: ProjectSummary[] };
  /** The ideas list, or a generation's progress, changed. */
  'projects:ideas-changed': IdeasState;
}

export const projectsForwardedEvents = ['projects:changed', 'projects:ideas-changed'] as const satisfies readonly (keyof ProjectsEvents)[];

export interface ProjectsApi {
  list(): Promise<IpcResult<ProjectSummary[]>>;
  /** Opens the native folder picker and adds what the user chose. */
  pick(): Promise<IpcResult<PickResult>>;
  remove(id: string): Promise<IpcResult<ProjectSummary[]>>;
  rescan(id: string): Promise<IpcResult<ProjectSummary>>;
  saveBrief(id: string, brief: ProjectBrief, options: ProjectOptions): Promise<IpcResult<ProjectSummary>>;
  /** "What did you build today?": a note for a project, or for none (`null`). */
  addNote(projectId: string | null, text: string): Promise<IpcResult<null>>;
  ideas(): Promise<IpcResult<IdeasState>>;
  /** `auto`: only from activity no generation has used yet; `force`: from the recent activity (an explicit request). */
  refreshIdeas(mode: 'auto' | 'force'): Promise<IpcResult<RefreshResult>>;
  cancelIdeas(): Promise<IpcResult<null>>;
  /** Marks an idea used (the composer has put its text in the draft). */
  useIdea(id: string): Promise<IpcResult<IdeasState>>;
  /** Dismisses an idea; the same story never comes back. */
  dismissIdea(id: string): Promise<IpcResult<IdeasState>>;
}
