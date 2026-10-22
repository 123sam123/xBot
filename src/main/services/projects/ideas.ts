import { z } from 'zod';
import { ideaCopy } from '../../../shared/ideaCopy';
import { IDEA_KINDS, type IdeaClaim, type IdeaKind, type IdeaSourceKind, type ProjectBrief } from '../../../shared/contracts/projects';
import { flagPhrases, stripAddedHashtags, type SourceGroup, type TaskSource } from '../ai/prompts';
import { toFormat, type OutputSpec } from '../ai/schemas';
import type { TaskSpec } from '../ai/service';
import { redact } from './redact';
import { cutBytes, sha256 } from './scanner';

// The project-ideas prompt and everything checked on what comes back. Pure:
// suggestions.ts feeds it rows and stores what survives.
//
// Trust: BRIEF, F* (confirmed facts) and N* (notes) are the user's own words;
// DIGEST (README and manifests) and E* (commits, docs, file names) come from
// the project and are untrusted. A claim counts as confirmed only when it
// rests on a user block, never on the model's say-so. Every idea must cite
// real activity (an E or N block), and a number that appears in none of the
// blocks discards the idea, so a measurable claim is never invented.

export const POST_MAX = 280;

const ideaItem = z.strictObject({
  kind: z.enum(IDEA_KINDS),
  text: z.string().trim().min(1).max(POST_MAX),
  sources: z.array(z.string().trim().max(8)).max(6),
  claims: z.array(z.strictObject({ text: z.string().trim().min(1).max(140), basis: z.string().trim().max(8) })).max(3),
});

function ideasSchema(max: number) {
  return z.strictObject({ ideas: z.array(ideaItem).max(max) });
}

export type IdeasSchema = ReturnType<typeof ideasSchema>;
export type IdeasOutput = z.output<IdeasSchema>;
export type RawIdea = IdeasOutput['ideas'][number];

function spec(max: number, numPredict: number): OutputSpec<IdeasSchema> {
  const schema = ideasSchema(max);
  return {
    schema,
    format: toFormat(schema),
    numPredict,
    field: z.string(),
    shape: '{"ideas": [{"kind": "bug_fix", "text": "<post>", "sources": ["E1"], "claims": [{"text": "<claim>", "basis": "N1"}]}]}',
  };
}

const LARGE = spec(3, 900);
const SMALL = spec(2, 600);

/** Three ideas in xBot's own 4096-token window; two when the model runs with less. */
export function ideasSpecFor(promptCtx: number): OutputSpec<IdeasSchema> {
  return promptCtx >= 4096 ? LARGE : SMALL;
}

const INSTRUCTIONS = [
  'Find build-in-public stories in this project activity worth a post.',
  `Per idea: kind (${IDEA_KINDS.join(', ')}); text, an X post under 280 characters in the voice above;`,
  'sources, ids of the E and N blocks it rests on; claims, statements the blocks do not directly show',
  '(that something shipped, works or helped someone), each with basis = the F or N id that states it, or "".',
  'BRIEF, F and N are the user’s words; E and DIGEST come from the project. A commit does not show it shipped or works.',
  'Use numbers only as they appear in the blocks. Nothing worth a post: {"ideas": []}.',
].join('\n');
if (new TextEncoder().encode(INSTRUCTIONS).length > 700) throw new Error('ideas: the instructions must stay within 700 bytes');

const escapeRules = (text: string) => text.replace(/<<</g, '‹‹‹').replace(/>>>/g, '›››');

/** The task for T6's `generateTask`. Sharing restrictions are the user's rules, so they go in the instructions. */
export function ideasTask(sharingRestrictions: string): TaskSpec<IdeasSchema> {
  const rules = sharingRestrictions.trim();
  return {
    label: 'ideas',
    instructions: rules === '' ? INSTRUCTIONS : `${INSTRUCTIONS}\nThe user’s sharing rules, never break them: ${cutBytes(escapeRules(rules), 500)}`,
    specFor: ideasSpecFor,
    shares: { activity: 0.6, brief: 0.2, facts: 0.1 },
    includeExamples: false,
    mustInclude: (names) => names.some((name) => /^[EN]\d+$/.test(name)),
  };
}

// ---------- Sources ----------

export interface IdeaEvent {
  id: string;
  kind: 'commit' | 'doc' | 'files' | 'note';
  summary: string;
  sourceRef: string;
  fingerprint: string;
  excerpt?: string;
}

export interface IdeaInput {
  /** The folder's realpath, or `general` for notes saved without a project. */
  scope: string;
  brief: ProjectBrief | null;
  digest: string | null;
  /** Newest first. Notes become N blocks, the rest E blocks. */
  events: IdeaEvent[];
}

export interface SourceRef {
  name: string;
  kind: IdeaSourceKind;
  label: string;
  /** Activity fingerprint (E and N blocks only). */
  fingerprint: string | null;
  eventId: string | null;
  userWritten: boolean;
  eventKind: IdeaEvent['kind'] | null;
}

function briefText(brief: ProjectBrief): string {
  return [
    `Name: ${brief.name}`,
    brief.whatItDoes && `What it does: ${brief.whatItDoes}`,
    brief.whyBuilt && `Why we built it: ${brief.whyBuilt}`,
    brief.intendedUsers && `Intended users: ${brief.intendedUsers}`,
    brief.stage && `Current stage: ${brief.stage}`,
    brief.publicUrl && `Public URL: ${brief.publicUrl}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The prompt's sources, in order: BRIEF, F1…, N1…, DIGEST, E1…. This is the
 * one place project text becomes model input, so every text is redacted here
 * again, whatever happened at ingest.
 */
export function buildIdeaSources(input: IdeaInput): { sources: TaskSource[]; refs: Map<string, SourceRef> } {
  const sources: TaskSource[] = [];
  const refs = new Map<string, SourceRef>();
  const add = (name: string, group: SourceGroup, text: string, ref: Omit<SourceRef, 'name'>) => {
    if (text.trim() === '') return;
    sources.push({ name, kind: 'project', group, text: redact(text) });
    refs.set(name, { name, ...ref });
  };
  const userRef = (kind: IdeaSourceKind, label: string): Omit<SourceRef, 'name'> => ({ kind, label, fingerprint: null, eventId: null, userWritten: true, eventKind: null });

  if (input.brief) add('BRIEF', 'brief', briefText(input.brief), userRef('brief', input.brief.name));
  input.brief?.confirmedFacts.forEach((fact, index) => add(`F${index + 1}`, 'facts', fact, userRef('fact', fact)));
  const notes = input.events.filter((e) => e.kind === 'note');
  const activity = input.events.filter((e) => e.kind !== 'note');
  notes.forEach((note, index) =>
    add(`N${index + 1}`, 'activity', note.summary, { kind: 'note', label: note.sourceRef, fingerprint: note.fingerprint, eventId: note.id, userWritten: true, eventKind: 'note' }),
  );
  if (input.digest) add('DIGEST', 'digest', input.digest, { kind: 'doc', label: 'README and manifest', fingerprint: null, eventId: null, userWritten: false, eventKind: null });
  activity.forEach((event, index) =>
    add(`E${index + 1}`, 'activity', event.excerpt ? `${event.summary}\nDiff excerpt:\n${event.excerpt}` : event.summary, {
      kind: event.kind,
      label: event.sourceRef,
      fingerprint: event.fingerprint,
      eventId: event.id,
      userWritten: false,
      eventKind: event.kind,
    }),
  );
  return { sources, refs };
}

// ---------- Checks on what came back ----------

export interface CheckedIdea {
  kind: IdeaKind;
  text: string;
  sources: SourceRef[];
  claims: IdeaClaim[];
  flags: { phrases: string[]; hashtagsStripped: string[] };
  /** Dedupe key: scope, kind and the activity it rests on. */
  fingerprint: string;
  /** Dismissal key: the same without the kind. */
  sourceKey: string;
  textNorm: string;
}

export interface CheckContext {
  scope: string;
  included: readonly { name: string; text: string }[];
  refs: ReadonlyMap<string, SourceRef>;
  banned: readonly string[];
}

const SHIPPED = /\b(?:ship(?:ped|s)?|launch(?:ed)?|releas(?:ed|e)|live|deploy(?:ed)?|works?|working|fixed|solved|users?|customers?)\b/i;
const URL = /\bhttps?:\/\/[^\s)<>"']+/gi;
const MENTION = /(?:^|[^\w@])(@\w{1,15})\b/g;
const STOPWORDS = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'were', 'will', 'just', 'into', 'than', 'then', 'they', 'them', 'what', 'when', 'your', 'about', 'there', 'which', 'would', 'could', 'should']);

/** Lowercase words without punctuation, for similarity. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(URL, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set Jaccard similarity of two normalised texts. */
export function jaccard(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter((w) => w.length > 2));
  const tb = new Set(b.split(' ').filter((w) => w.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const word of ta) if (tb.has(word)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

const contentWords = (text: string) => new Set((text.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOPWORDS.has(w)));

function sharesContentWord(a: string, b: string): boolean {
  const words = contentWords(b);
  for (const word of contentWords(a)) if (words.has(word)) return true;
  return false;
}

/** Number tokens with separators removed: "1,200" and "1.2.3" become "1200" and "123". */
function numberTokens(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((t) => t.replace(/[.,]/g, ''));
}

/** The text the number check may count as grounding: no diff stats or xBot's own counts. */
function numberHaystack(texts: readonly string[]): Set<string> {
  const cleaned = texts.map((t) =>
    t
      .replace(/\(\+\d+ −\d+\)/g, ' ')
      .replace(/\(?\+\d+ (?:more|private files?)\)?/g, ' ')
      .replace(/\b[EFN]\d+\b/g, ' '),
  );
  return new Set(cleaned.flatMap(numberTokens));
}

const sentenceWith = (text: string, index: number) => {
  const start = Math.max(text.lastIndexOf('.', index) + 1, text.lastIndexOf('!', index) + 1, text.lastIndexOf('?', index) + 1, 0);
  const rest = text.slice(index).search(/[.!?](?:\s|$)/);
  return text.slice(start, rest >= 0 ? index + rest + 1 : undefined).trim().slice(0, 140);
};

/** Keeps the ideas that are grounded, honest and new; attaches what needs confirming. */
export function checkIdeas(raw: readonly RawIdea[], ctx: CheckContext): CheckedIdea[] {
  const included = new Map(ctx.included.map((s) => [s.name, s.text]));
  const haystack = numberHaystack([...included.values()]);
  const userTexts = [...included.entries()].filter(([name]) => ctx.refs.get(name)?.userWritten).map(([, text]) => text);
  const userLower = userTexts.join('\n').toLowerCase();
  const banned = new Set(ctx.banned.map((p) => p.trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const out: CheckedIdea[] = [];

  for (const idea of raw) {
    const names = [...new Set(idea.sources.map((s) => s.trim().toUpperCase()))].filter((n) => included.has(n) && ctx.refs.has(n));
    const activity = names.filter((n) => /^[EN]\d+$/.test(n)).map((n) => ctx.refs.get(n)!);
    // Grounded on real activity, and on more than a list of changed file names.
    if (activity.length === 0 || activity.every((r) => r.eventKind === 'files')) continue;
    // A number in none of the blocks is an invented measurable claim.
    if (numberTokens(idea.text).some((n) => !haystack.has(n))) continue;

    const { text, stripped } = stripAddedHashtags(idea.text, userTexts);
    if (text.trim() === '') continue;
    const phrases = flagPhrases(text, [...ctx.banned]);
    if (phrases.some((p) => banned.has(p.toLowerCase()))) continue;

    const claims: IdeaClaim[] = [];
    const addClaim = (claim: IdeaClaim) => {
      if (!claims.some((c) => c.text.toLowerCase() === claim.text.toLowerCase())) claims.push(claim);
    };
    for (const claim of idea.claims) {
      const basis = claim.basis.trim().toUpperCase();
      const basisText = /^[FN]\d+$/.test(basis) ? included.get(basis) : undefined;
      const confirmed = basisText !== undefined && sharesContentWord(claim.text, basisText);
      addClaim({ text: claim.text, confirmed, reason: confirmed ? null : ideaCopy.claims.notConfirmed });
    }
    const shipped = SHIPPED.exec(text);
    if (shipped && !names.some((n) => ctx.refs.get(n)?.userWritten)) {
      addClaim({ text: sentenceWith(text, shipped.index), confirmed: false, reason: ideaCopy.claims.commitOnly });
    }
    for (const match of text.matchAll(URL)) {
      if (!userLower.includes(match[0].toLowerCase())) addClaim({ text: match[0], confirmed: false, reason: ideaCopy.claims.linkUnknown });
    }
    for (const match of text.matchAll(MENTION)) {
      if (!userLower.includes(match[1]!.toLowerCase())) addClaim({ text: match[1]!, confirmed: false, reason: ideaCopy.claims.linkUnknown });
    }

    const fingerprints = activity.map((r) => r.fingerprint!).sort();
    const sourceKey = sha256([ctx.scope, ...fingerprints].join('\0'));
    const fingerprint = sha256([ctx.scope, idea.kind, ...fingerprints].join('\0'));
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({
      kind: idea.kind,
      text,
      sources: names.map((n) => ctx.refs.get(n)!),
      claims,
      flags: { phrases: phrases.filter((p) => !banned.has(p.toLowerCase())), hashtagsStripped: stripped },
      fingerprint,
      sourceKey,
      textNorm: normalizeText(text),
    });
  }
  return out;
}
