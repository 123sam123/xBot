import * as twitterText from 'twitter-text';
import type { TimelinePost } from './api';

// Finding a job's post among the account's recent posts, after an uncertain
// create. Pure, so it is tested directly. X returns a post's text with every
// link rewritten to t.co (scheme-less links too), `&`, `<` and `>` escaped,
// and a t.co link to the media appended, so byte equality would never match:
// a post with media is matched by its media ids, a text-only post by its text
// with links replaced.

// twitter-text ships only a default export; see src/shared/postLength.ts.
const tt: typeof twitterText = (twitterText as unknown as { default?: typeof twitterText }).default ?? twitterText;

const URL_TOKEN = '\u0000url\u0000';

function replaceUrls(text: string): string {
  const ranges = tt.extractUrlsWithIndices(text).sort((a, b) => b.indices[0] - a.indices[0]);
  let out = text;
  for (const { indices } of ranges) out = out.slice(0, indices[0]) + URL_TOKEN + out.slice(indices[1]);
  return out;
}

/** Text as X stores it and as xBot froze it, made comparable. */
export function normalizeForMatch(text: string, escaped: boolean): string {
  const decoded = escaped ? text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&') : text;
  return replaceUrls(decoded.normalize('NFC')).replace(/\s+/g, ' ').trim();
}

/** The numeric media id inside a media key (`3_1880028106020515840` → `1880028106020515840`). */
export function mediaKeyId(key: string): string {
  return key.slice(key.indexOf('_') + 1);
}

export interface MatchTarget {
  frozenText: string;
  /** Each create attempt's media ids, in order; empty for a text-only post. */
  mediaIdSets: readonly (readonly string[])[];
}

export function matchesPost(post: TimelinePost, target: MatchTarget): boolean {
  const sets = target.mediaIdSets.filter((set) => set.length > 0);
  if (sets.length > 0) {
    const ids = post.mediaKeys.map(mediaKeyId);
    return sets.some((set) => set.length === ids.length && set.every((id, i) => ids[i] === id));
  }
  if (post.mediaKeys.length > 0) return false;
  return normalizeForMatch(post.text, true) === normalizeForMatch(target.frozenText, false);
}

/** The earliest matching post, or null. */
export function findMatch(posts: readonly TimelinePost[], target: MatchTarget): TimelinePost | null {
  const matches = posts.filter((p) => matchesPost(p, target));
  matches.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.length - b.id.length || a.id.localeCompare(b.id));
  return matches[0] ?? null;
}
