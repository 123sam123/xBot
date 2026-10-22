import type { z } from 'zod';
import { OllamaError, type ChatMessage, type OllamaClient } from './ollamaClient';
import { extractCompleteStrings } from './partial';
import { repairMessages, stripThink } from './prompts';
import type { OutputSpec } from './schemas';

// One structured generation: stream /api/chat with a JSON-schema `format`,
// show complete fields as they arrive, validate the result with zod, and
// re-ask at most twice when it is invalid. Only invalid output is retried;
// timeouts, refusals and dropped streams fail at once.

/** Content past this is not a short post; the attempt is abandoned as malformed. */
export const MAX_CONTENT_BYTES = 16 * 1024;
export const MAX_REPAIRS = 2;

export interface StructuredProgress {
  attempt: number;
  /** Top-level string fields that are complete and within bounds. */
  fields: Record<string, string>;
  chars: number;
}

export interface RunStructuredOptions<S extends z.ZodType> {
  client: OllamaClient;
  model: string;
  /** Send `think:false` (only for models that advertise thinking). */
  disableThinking: boolean;
  messages: ChatMessage[];
  spec: OutputSpec<S>;
  signal: AbortSignal;
  attemptTimeoutMs: number;
  numCtx: number;
  keepAlive: string | number;
  /** Turns a streamed field into what the user sees (post-checks), or null to hold it back. */
  showField?(name: string, value: string): string | null;
  onProgress?(progress: StructuredProgress): void;
}

export async function runStructured<S extends z.ZodType>(options: RunStructuredOptions<S>): Promise<{ value: z.output<S>; attempts: number }> {
  const { client, model, spec, signal } = options;
  let messages = options.messages;
  for (let attempt = 1; ; attempt += 1) {
    let content = '';
    let doneReason: string | undefined;
    try {
      await client.chat(
        {
          model,
          messages,
          format: spec.format,
          keep_alive: options.keepAlive,
          ...(options.disableThinking ? { think: false } : {}),
          options: { num_ctx: options.numCtx, num_predict: spec.numPredict, temperature: attempt === 1 ? 0.6 : 0.2 },
        },
        {
          signal,
          attemptTimeoutMs: options.attemptTimeoutMs,
          onChunk(chunk) {
            content += chunk.message?.content ?? '';
            if (chunk.done) doneReason = chunk.done_reason;
            if (content.length > MAX_CONTENT_BYTES / 4 && new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
              throw new OllamaError('too_long', 'The answer ran past its size limit.');
            }
            if (!options.onProgress) return;
            const fields: Record<string, string> = {};
            for (const [name, raw] of Object.entries(extractCompleteStrings(stripThink(content)))) {
              if (!spec.field.safeParse(raw).success) continue;
              const visible = options.showField ? options.showField(name, raw) : raw;
              if (visible !== null) fields[name] = visible;
            }
            options.onProgress({ attempt, fields, chars: content.length });
          },
        },
      );
    } catch (err) {
      // A size overrun is a malformed answer: repair it like one.
      if (!(err instanceof OllamaError && err.code === 'too_long')) throw err;
      if (attempt > MAX_REPAIRS) throw new OllamaError('malformed', 'The answer kept running past its size limit.');
      messages = [...options.messages, ...repairMessages(content, 'length')];
      continue;
    }

    const problem = validate(spec.schema, stripThink(content), doneReason);
    if (problem.ok) return { value: problem.value, attempts: attempt };
    if (attempt > MAX_REPAIRS) throw new OllamaError('malformed', `The answer did not fit the format: ${problem.issue}`);
    // Each repair starts from the original prompt, so the context never grows past one repair turn.
    messages = [...options.messages, ...repairMessages(content, problem.issue)];
  }
}

function validate<S extends z.ZodType>(
  schema: S,
  content: string,
  doneReason: string | undefined,
): { ok: true; value: z.output<S> } | { ok: false; issue: string } {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false, issue: doneReason === 'length' ? 'length' : 'the reply is not valid JSON' };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  if (doneReason === 'length') return { ok: false, issue: 'length' };
  const first = parsed.error.issues[0];
  return { ok: false, issue: first ? `${first.path.join('.') || 'value'}: ${first.message}` : 'invalid' };
}
