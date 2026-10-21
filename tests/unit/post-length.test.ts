import { describe, expect, it } from 'vitest';
import { POST_LIMIT, postLength } from '../../src/shared/postLength';

// The composer's counter uses X's weighted length (twitter-text), not code points.

describe('postLength', () => {
  it('counts any URL as 23', () => {
    expect(postLength('https://example.com/a').weightedLength).toBe(23);
    expect(postLength('see https://example.com/a/very/long/path?with=query&and=more').weightedLength).toBe(4 + 23);
  });

  it('counts an emoji as 2', () => {
    expect(postLength('👍').weightedLength).toBe(2);
  });

  it('weights CJK characters as 2 each', () => {
    expect(postLength('你好').weightedLength).toBe(4);
  });

  it('flags 281 weighted characters as over the 280 limit, and not 280', () => {
    expect(POST_LIMIT).toBe(280);
    expect(postLength('a'.repeat(280))).toEqual({ weightedLength: 280, overLimit: false, limit: 280 });
    expect(postLength('a'.repeat(281))).toEqual({ weightedLength: 281, overLimit: true, limit: 280 });
  });
});
