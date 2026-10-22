// Reads a JSON object while it is still streaming in, so each suggestion can
// be shown as soon as its text is complete (brief §9). Only top-level string
// properties whose closing quote has arrived are returned; nothing is guessed.

export function extractCompleteStrings(partial: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = partial.indexOf('{');
  if (i < 0) return out;
  i += 1;
  let depth = 1;
  let pendingKey: string | null = null;
  let expectValue = false;

  /** Returns the index just past the closing quote of the string at `start`, or -1 if it has not closed yet. */
  const endOfString = (start: number): number => {
    for (let j = start + 1; j < partial.length; j += 1) {
      const ch = partial[j];
      if (ch === '\\') j += 1;
      else if (ch === '"') return j + 1;
    }
    return -1;
  };

  while (i < partial.length && depth > 0) {
    const ch = partial[i]!;
    if (ch === '"') {
      const end = endOfString(i);
      if (end < 0) break;
      let value: string;
      try {
        value = JSON.parse(partial.slice(i, end)) as string;
      } catch {
        break;
      }
      if (depth === 1) {
        if (expectValue && pendingKey !== null) {
          out[pendingKey] = value;
          pendingKey = null;
          expectValue = false;
        } else {
          pendingKey = value;
        }
      }
      i = end;
      continue;
    }
    if (ch === ':' && depth === 1) expectValue = true;
    else if (ch === ',' && depth === 1) {
      pendingKey = null;
      expectValue = false;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
      if (depth === 2) {
        pendingKey = null;
        expectValue = false;
      }
    } else if (ch === '}' || ch === ']') depth -= 1;
    i += 1;
  }
  return out;
}
