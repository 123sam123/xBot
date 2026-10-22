// Newline-delimited JSON, as Ollama streams /api/chat and /api/pull.

export const MAX_NDJSON_LINE = 1024 * 1024;

export class NdjsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NdjsonError';
  }
}

/**
 * Calls `onLine` with each parsed line of `body`, in order. A multi-byte
 * character split across chunks is decoded whole; a line longer than
 * `maxLineBytes` (or invalid JSON) throws NdjsonError.
 */
export async function readNdjson(
  body: AsyncIterable<Uint8Array>,
  onLine: (value: unknown) => void,
  maxLineBytes = MAX_NDJSON_LINE,
): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const flush = (line: string) => {
    if (line.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new NdjsonError('invalid JSON line');
    }
    onLine(value);
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      flush(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
    if (buffer.length > maxLineBytes) throw new NdjsonError('line too long');
  }
  buffer += decoder.decode();
  flush(buffer);
}
