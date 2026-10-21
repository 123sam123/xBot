import * as twitterText from 'twitter-text';

// X's weighted post length, from the official twitter-text rules: a URL counts
// as 23, an emoji as 2, CJK characters as 2 each, most Latin text as 1.
//
// twitter-text 3.1.0 ships only a default export (ESM `export default {…}`,
// CJS `module.exports = exports.default`) while its types declare named ones,
// so the API is unwrapped from whichever shape the bundler hands over.
const api: typeof twitterText = (twitterText as unknown as { default?: typeof twitterText }).default ?? twitterText;

/** X's limit for a standard post. */
export const POST_LIMIT = 280;

export interface PostLength {
  weightedLength: number;
  overLimit: boolean;
  limit: number;
}

export function postLength(text: string): PostLength {
  const { weightedLength } = api.parseTweet(text);
  return { weightedLength, overLimit: weightedLength > POST_LIMIT, limit: POST_LIMIT };
}
