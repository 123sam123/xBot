import { z } from 'zod';

// What the model must return, per kind of request. The zod schema validates;
// the same schema, as JSON Schema, goes to Ollama's `format`, so the grammar
// already enforces the shape (one text per story angle, bounded lengths).

export const POST_MAX = 280;

const postText = z.string().trim().min(1).max(POST_MAX);

export const storyOutput = z.strictObject({
  problem_solution: postText,
  progress_lesson: postText,
  funny_observation: postText,
});

export const rewriteOutput = z.strictObject({ text: z.string().trim().min(1).max(600) });

export const briefOutput = z.strictObject({ brief: z.string().trim().min(1).max(1200) });

export interface OutputSpec<S extends z.ZodType> {
  schema: S;
  /** The JSON Schema sent as `format`. */
  format: object;
  /** Upper bound on generated tokens: the schema's longest valid answer plus JSON overhead. */
  numPredict: number;
  /** Bounds a single streamed string field must meet before it is shown. */
  field: z.ZodString;
  /** The shape, in words, for the prompt (the docs recommend stating it as well). */
  shape: string;
}

/** Every output here is an object of strings. */
export type AnyOutputSpec = OutputSpec<z.ZodType<Record<string, string>>>;

function toFormat(schema: z.ZodType): object {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export const STORY: OutputSpec<typeof storyOutput> = {
  schema: storyOutput,
  format: toFormat(storyOutput),
  numPredict: 400,
  field: postText,
  shape: '{"problem_solution": "<post>", "progress_lesson": "<post>", "funny_observation": "<post>"}',
};

export const REWRITE: OutputSpec<typeof rewriteOutput> = {
  schema: rewriteOutput,
  format: toFormat(rewriteOutput),
  numPredict: 256,
  field: rewriteOutput.shape.text,
  shape: '{"text": "<the rewritten text>"}',
};

export const BRIEF: OutputSpec<typeof briefOutput> = {
  schema: briefOutput,
  format: toFormat(briefOutput),
  numPredict: 480,
  field: briefOutput.shape.brief,
  shape: '{"brief": "<the style brief>"}',
};
