// Owned by T6 (XBOT-4BCGOR). Local AI through native Ollama on this Mac:
// settings, payload schemas, events and the bridge API. The verified Ollama
// behaviour is in docs/OLLAMA.md; the design is in ARCHITECTURE.md → "Local AI".
import { z } from 'zod';
import { DEFAULT_AI_ENDPOINT, isLoopbackEndpoint } from '../aiEndpoint';
import { defineSetting, type SettingsShape } from './define';
import type { IpcResult } from './ipc';

/** A model name as Ollama prints it: no whitespace or control characters. */
export const modelNameSchema = z.string().regex(/^[^\s\p{Cc}]{1,300}$/u);

export const aiSettings = {
  /** Only a loopback Ollama endpoint (src/shared/aiEndpoint.ts). */
  'ai.endpoint': defineSetting(z.string().max(64).refine(isLoopbackEndpoint), DEFAULT_AI_ENDPOINT),
  /** The chosen model; null picks an installed local model automatically. */
  'ai.model': defineSetting(modelNameSchema.nullable(), null),
  /** Smaller context, and the model is unloaded after each request. */
  'ai.lowResource': defineSetting(z.boolean(), false),
  /** Per-attempt limit, from the request being sent (model load included). */
  'ai.generationTimeoutSec': defineSetting(z.number().int().min(30).max(600), 90),
} satisfies SettingsShape;

export type AiAction = 'story' | 'shorter' | 'casual' | 'angle' | 'selection';
export type AiAngle = 'problem_solution' | 'progress_lesson' | 'funny_observation';
export const AI_ANGLES: readonly AiAngle[] = ['problem_solution', 'progress_lesson', 'funny_observation'];

/** One piece of material for a prompt. T7 adds `project` sources. */
export interface AiSource {
  name: string;
  kind: 'draft' | 'note' | 'selection' | 'project';
  text: string;
}

/** A suggestion. `flags` are post-checks the UI shows next to it. */
export interface AiOption {
  angle: AiAngle | null;
  text: string;
  flags: {
    /** Numbers absent from every source: shown as "Confirm …". */
    numbers: string[];
    /** Banned or generic phrases it uses. */
    phrases: string[];
    /** Hashtags the model added that no source had; already removed from `text`. */
    hashtagsStripped: string[];
  };
}

export type AiResult = { status: 'done'; options: AiOption[]; trimmed: boolean } | { status: 'cancelled' };
export type BriefResult = { status: 'done'; brief: string } | { status: 'cancelled' };

/** A verified download (docs/OLLAMA.md → "Suggested models"). */
export interface CatalogEntry {
  name: string;
  downloadBytes: number;
  sizeLabel: string;
  minRamGB: number;
  note: string;
  recommended: boolean;
}

export type ModelVerdict = 'local' | 'remote' | 'unverifiable' | 'unsuitable';

export interface AiModel {
  name: string;
  digest: string;
  sizeBytes: number;
  parameterSize: string | null;
  verdict: ModelVerdict;
  reason: string;
}

export interface AiState {
  /** `checking` only until the first probe settles; later probes keep the last phase. */
  phase: 'checking' | 'not_running' | 'model_needed' | 'ready';
  /** Why the probe failed, when it is more specific than "not running". */
  probeError: { code: string; message: string } | null;
  endpoint: string;
  version: string | null;
  /** From Ollama's `/api/status`, when it reports one. Informational only. */
  cloudDisabled: boolean | null;
  models: AiModel[];
  /** The model generation uses: the chosen one, or the automatic pick. */
  selected: string | null;
  selectedVerdict: ModelVerdict | null;
  /** True when the user chose `selected` (the `ai.model` setting). */
  selectedByUser: boolean;
  recommendations: (CatalogEntry & { installed: boolean })[];
  totalMemBytes: number;
  lowResource: boolean;
  pull: { model: string; percent: number; status: string; error: string | null; active: boolean } | null;
  running: { requestId: string; action: AiAction | 'brief'; priority: 'interactive' | 'background' } | null;
  /** What to tell the user in this phase (src/shared/aiCopy.ts). */
  guidance: string;
}

export type VoiceEmoji = 'none' | 'sparingly' | 'freely';
export type VoiceProfanity = 'none' | 'mild' | 'ok';

export interface VoiceExample {
  id: string;
  text: string;
  createdAt: string;
}

export interface VoiceProfile {
  /** 0 casual … 100 polished. */
  casualPolished: number;
  /** 0 dry … 100 playful. */
  dryPlayful: number;
  /** 0 technical … 100 accessible. */
  technicalAccessible: number;
  emoji: VoiceEmoji;
  profanity: VoiceProfanity;
  bannedPhrases: string[];
  styleBrief: string;
  /** Approved examples, newest first. */
  examples: VoiceExample[];
}

export const VOICE_LIMITS = { bannedPhrases: 50, bannedPhraseLength: 80, styleBrief: 1200, examples: 20, exampleLength: 2000 } as const;

/** The post text bound (the drafts contract's DRAFT_TEXT_MAX). */
const TEXT_MAX = 25_000;

export const generateSchema = z
  .strictObject({
    requestId: z.uuid(),
    action: z.enum(['story', 'shorter', 'casual', 'angle', 'selection']),
    text: z.string().max(TEXT_MAX),
    note: z.string().max(1_000).optional(),
    selection: z.strictObject({ start: z.number().int().min(0), end: z.number().int().min(0) }).optional(),
  })
  .refine((p) => (p.action === 'selection') === (p.selection !== undefined), { message: 'selection goes with the selection action' })
  .refine((p) => !p.selection || (p.selection.start < p.selection.end && p.selection.end <= p.text.length), {
    message: 'selection is outside the text',
  });
export type GeneratePayload = z.infer<typeof generateSchema>;

export const requestIdSchema = z.strictObject({ requestId: z.uuid() });
export const getStateSchema = z.strictObject({ refresh: z.enum(['cached', 'throttled', 'force']) });
export const selectModelSchema = z.strictObject({ model: modelNameSchema.nullable() });
export const pullSchema = z.strictObject({ model: modelNameSchema });

const sliderSchema = z.number().int().min(0).max(100);
export const voicePatchSchema = z
  .strictObject({
    casualPolished: sliderSchema.optional(),
    dryPlayful: sliderSchema.optional(),
    technicalAccessible: sliderSchema.optional(),
    emoji: z.enum(['none', 'sparingly', 'freely']).optional(),
    profanity: z.enum(['none', 'mild', 'ok']).optional(),
    bannedPhrases: z
      .array(z.string().trim().min(1).max(VOICE_LIMITS.bannedPhraseLength))
      .max(VOICE_LIMITS.bannedPhrases)
      .optional(),
    styleBrief: z.string().max(VOICE_LIMITS.styleBrief).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'empty voice patch' });
export type VoicePatch = z.infer<typeof voicePatchSchema>;

export const addExampleSchema = z.strictObject({ text: z.string().trim().min(1).max(VOICE_LIMITS.exampleLength) });
export const removeExampleSchema = z.strictObject({ id: z.uuid() });

export interface AiEvents {
  /** The whole AI state, whenever it changes. */
  'ai:state': AiState;
  /** Options validated so far for a running request (throttled). `attempt` counts repairs from 1. */
  'ai:progress': { requestId: string; attempt: number; options: AiOption[]; chars: number };
  /** Download progress (throttled); completion and errors arrive in `ai:state`. */
  'ai:pull-progress': { model: string; percent: number; status: string };
}

export const aiForwardedEvents = ['ai:state', 'ai:progress', 'ai:pull-progress'] as const satisfies readonly (keyof AiEvents)[];

export interface AiApi {
  /** `cached`: no probe; `throttled`: at most one probe per 10 s; `force`: probe now. */
  getState(refresh: 'cached' | 'throttled' | 'force'): Promise<IpcResult<AiState>>;
  /** Chooses an installed local model; null goes back to the automatic pick. */
  selectModel(model: string | null): Promise<IpcResult<AiState>>;
  generate(payload: GeneratePayload): Promise<IpcResult<AiResult>>;
  /** Cancels a queued or running request; its `generate` resolves `cancelled`. */
  cancel(requestId: string): Promise<IpcResult<null>>;
  /** Starts downloading a suggested model; returns once it has started. */
  pull(model: string): Promise<IpcResult<null>>;
  cancelPull(): Promise<IpcResult<null>>;
  getVoice(): Promise<IpcResult<VoiceProfile>>;
  /** Updates only the given fields. */
  saveVoice(patch: VoicePatch): Promise<IpcResult<VoiceProfile>>;
  addExample(text: string): Promise<IpcResult<VoiceProfile>>;
  removeExample(id: string): Promise<IpcResult<VoiceProfile>>;
  /** Writes a style brief from the approved examples, locally. Nothing is saved. */
  deriveStyleBrief(requestId: string): Promise<IpcResult<BriefResult>>;
}
