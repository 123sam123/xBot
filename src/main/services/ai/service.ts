import { aiCopy } from '../../../shared/aiCopy';
import {
  AI_ANGLES,
  type AiAction,
  type AiEvents,
  type AiModel,
  type AiOption,
  type AiResult,
  type AiSource,
  type AiState,
  type BriefResult,
  type VoicePatch,
  type VoiceProfile,
} from '../../../shared/contracts/ai';
import type { Db } from '../../db';
import { IpcError } from '../../ipc/core';
import type { Logger } from '../../log';
import { findModel, isCatalogModel, pickDefault, recommend } from './catalog';
import { toIpcError } from './errors';
import { runStructured } from './generate';
import { assessModel } from './locality';
import { createOllamaClient, OllamaError, type FetchLike, type OllamaClient, type OllamaShow, type OllamaTag } from './ollamaClient';
import { buildMessages, flagPhrases, flagUnsupportedNumbers, outputSpecFor, stripAddedHashtags, type PromptAction } from './prompts';
import { createAiQueue, isCancellation, type Priority } from './queue';
import { chooseRuntime, wouldEvict } from './runtime';
import { statusFor } from './status';
import { createVoiceStore } from './voice';

// The `ai` domain's main-process service (ARCHITECTURE.md → "Local AI").
// Electron-free: index.ts wires it to settings, events and the status
// registry; tests drive it against a mock Ollama on 127.0.0.1.

export interface AiSettingsSnapshot {
  endpoint: string;
  model: string | null;
  lowResource: boolean;
  timeoutSec: number;
}

export interface GenerateRequest {
  requestId: string;
  action: AiAction;
  sources: AiSource[];
  priority: Priority;
}

export interface AiServiceDeps {
  db: Db;
  getSettings(): AiSettingsSnapshot;
  /** Stores the chosen model (the `ai.model` setting). */
  setModel(model: string | null): void;
  isPreview: boolean;
  log: Logger;
  emit<K extends keyof AiEvents>(name: K, payload: AiEvents[K]): void;
  /** Called when the status chip may have changed (status registry). */
  onStatusChange?(): void;
  fetch?: FetchLike;
  totalMemBytes: number;
  now?(): number;
  env?: NodeJS.ProcessEnv;
  execArgv?: readonly string[];
  progressIntervalMs?: number;
}

const THROTTLE_PROBE_MS = 10_000;
const PULL_PROGRESS_MS = 200;

export type AiService = ReturnType<typeof createAiService>;

export function createAiService(deps: AiServiceDeps) {
  const now = deps.now ?? (() => Date.now());
  const progressIntervalMs = deps.progressIntervalMs ?? 250;
  const voice = createVoiceStore(deps.db);
  const queue = createAiQueue();

  // ---------- probe state ----------
  let probedOnce = false;
  let lastProbeAt = 0;
  let probeGen = 0;
  let inflight: Promise<AiState> | null = null;
  let reachable = false;
  let probeError: AiState['probeError'] = null;
  let version: string | null = null;
  let cloudDisabled: boolean | null = null;
  let models: AiModel[] = [];
  let tags = new Map<string, OllamaTag>();
  const shows = new Map<string, OllamaShow>(); // by digest; successes only
  let pull: AiState['pull'] = null;
  let pullController: AbortController | null = null;
  let running: AiState['running'] = null;
  let lastChip = '';
  let clientCache: { endpoint: string; client: OllamaClient } | null = null;

  function client(endpoint: string): OllamaClient {
    if (clientCache?.endpoint !== endpoint) {
      clientCache = { endpoint, client: createOllamaClient({ endpoint, fetch: deps.fetch, env: deps.env, execArgv: deps.execArgv }) };
    }
    return clientCache.client;
  }

  function selection(settings: AiSettingsSnapshot): Pick<AiState, 'selected' | 'selectedVerdict' | 'selectedByUser'> {
    if (settings.model) {
      const found = findModel(models, settings.model);
      return { selected: found?.name ?? settings.model, selectedVerdict: found?.verdict ?? null, selectedByUser: true };
    }
    const auto = pickDefault(models);
    return { selected: auto, selectedVerdict: auto ? 'local' : null, selectedByUser: false };
  }

  function snapshot(): AiState {
    const settings = deps.getSettings();
    const chosen = selection(settings);
    const phase: AiState['phase'] = !probedOnce
      ? 'checking'
      : !reachable
        ? 'not_running'
        : chosen.selected && chosen.selectedVerdict === 'local'
          ? 'ready'
          : 'model_needed';
    const installed = new Set(models.map((m) => m.name));
    return {
      phase,
      probeError,
      endpoint: settings.endpoint,
      version,
      cloudDisabled,
      models,
      ...chosen,
      recommendations: recommend(deps.totalMemBytes).map((entry) => ({ ...entry, installed: installed.has(entry.name) || findModel(models, entry.name) !== undefined })),
      totalMemBytes: deps.totalMemBytes,
      lowResource: settings.lowResource,
      pull,
      running,
      guidance: guidanceFor(phase, chosen.selected, chosen.selectedVerdict),
    };
  }

  function guidanceFor(phase: AiState['phase'], selected: string | null, verdict: AiModel['verdict'] | null): string {
    const e = aiCopy.errors;
    switch (phase) {
      case 'checking':
        return aiCopy.guidance.checking;
      case 'not_running':
        return probeError?.message ?? e.ollama_unavailable;
      case 'ready':
        return aiCopy.guidance.ready(selected ?? '');
      case 'model_needed':
        if (selected && verdict === 'remote') return e.remote_refused(selected);
        if (selected && verdict === 'unverifiable') return e.model_unverifiable(selected);
        if (models.length === 0) return aiCopy.guidance.noModels;
        return e.model_needed;
    }
  }

  function publish(): AiState {
    const state = snapshot();
    deps.emit('ai:state', state);
    const chip = JSON.stringify(statusFor(state));
    if (chip !== lastChip) {
      lastChip = chip;
      deps.onStatusChange?.();
    }
    return state;
  }

  async function doProbe(gen: number): Promise<AiState> {
    const settings = deps.getSettings();
    try {
      const c = client(settings.endpoint);
      const [v, status] = await Promise.all([c.version(), c.status().catch(() => null)]);
      const list = await c.tags();
      const assessed = await Promise.all(
        list.models.map(async (tag) => {
          let show = shows.get(tag.digest) ?? null;
          if (!show) {
            show = await c.show(tag.name).catch((err: unknown) => {
              deps.log.warn(`ai: /api/show failed for ${tag.name}`, err instanceof Error ? err.message : err);
              return null;
            });
            if (show) shows.set(tag.digest, show);
          }
          const { verdict, reason } = assessModel(tag, show);
          const model: AiModel = { name: tag.name, digest: tag.digest, sizeBytes: tag.size, parameterSize: tag.details?.parameter_size ?? null, verdict, reason };
          return model;
        }),
      );
      if (gen !== probeGen) return snapshot();
      reachable = true;
      probeError = null;
      version = v.version;
      cloudDisabled = status?.cloud?.disabled ?? null;
      models = assessed;
      tags = new Map(list.models.map((t) => [t.name, t]));
    } catch (err) {
      if (gen !== probeGen) return snapshot();
      const ipc = toIpcError(err, { phase: 'probe' }, settings.endpoint);
      reachable = false;
      probeError = ipc.code === 'ollama_unavailable' ? null : { code: ipc.code, message: ipc.message };
      version = null;
      cloudDisabled = null;
      models = [];
      tags = new Map();
    }
    probedOnce = true;
    lastProbeAt = now();
    return publish();
  }

  function probe(mode: 'cached' | 'throttled' | 'force'): Promise<AiState> {
    if (deps.isPreview) return Promise.resolve(snapshot());
    if (probedOnce && mode === 'cached') return Promise.resolve(snapshot());
    if (probedOnce && mode === 'throttled' && now() - lastProbeAt < THROTTLE_PROBE_MS) return Promise.resolve(snapshot());
    if (inflight) return inflight;
    const gen = ++probeGen;
    const run = doProbe(gen).finally(() => {
      if (inflight === run) inflight = null;
    });
    inflight = run;
    return run;
  }

  function setRunning(next: AiState['running']): void {
    running = next;
    publish();
  }

  /** Probes, then returns the effective model if it may generate; throws the reason otherwise. */
  async function readyModel(signal: AbortSignal): Promise<{ c: OllamaClient; model: string; tag: OllamaTag; thinking: boolean }> {
    const state = await probe('force');
    throwIfAborted(signal);
    if (state.phase === 'not_running') {
      throw state.probeError ? new IpcError(state.probeError.code, state.probeError.message) : new IpcError('ollama_unavailable', aiCopy.errors.ollama_unavailable);
    }
    const model = state.selected;
    const tag = model ? tags.get(model) : undefined;
    if (!model || !tag || state.selectedVerdict !== 'local') {
      if (model && state.selectedVerdict === 'remote') throw new IpcError('remote_refused', aiCopy.errors.remote_refused(model));
      if (model && state.selectedVerdict === 'unverifiable') throw new IpcError('model_unverifiable', aiCopy.errors.model_unverifiable(model));
      throw new IpcError('model_needed', aiCopy.errors.model_needed);
    }
    const show = shows.get(tag.digest);
    return { c: client(state.endpoint), model, tag, thinking: show?.capabilities?.includes('thinking') ?? false };
  }

  function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw signal.reason instanceof OllamaError ? signal.reason : new OllamaError('aborted', 'Cancelled.');
  }

  function postCheck(text: string, sourceTexts: readonly string[], banned: readonly string[]): { text: string; flags: AiOption['flags'] } {
    const { text: cleaned, stripped } = stripAddedHashtags(text, sourceTexts);
    return {
      text: cleaned,
      flags: { numbers: flagUnsupportedNumbers(cleaned, sourceTexts), phrases: flagPhrases(cleaned, banned), hashtagsStripped: stripped },
    };
  }

  function toOptions(action: AiAction, fields: Record<string, string>, sourceTexts: readonly string[], banned: readonly string[]): AiOption[] {
    if (action === 'story') {
      return AI_ANGLES.flatMap((angle) => {
        const raw = fields[angle];
        return raw === undefined ? [] : [{ angle, ...postCheck(raw, sourceTexts, banned) }];
      });
    }
    return fields.text === undefined ? [] : [{ angle: null, ...postCheck(fields.text, sourceTexts, banned) }];
  }

  /** The common path for every generation: model check, memory rules, prompt, structured run. */
  async function run(
    action: PromptAction,
    sources: readonly AiSource[],
    voiceProfile: VoiceProfile,
    signal: AbortSignal,
    onFields?: (attempt: number, fields: Record<string, string>, chars: number) => void,
  ): Promise<{ fields: Record<string, string>; trimmed: boolean }> {
    const settings = deps.getSettings();
    const { c, model, tag, thinking } = await readyModel(signal);
    try {
      const ps = await c.ps(signal);
      throwIfAborted(signal);
      const loaded = ps.models.find((m) => m.digest === tag.digest);
      const others = ps.models.filter((m) => m.digest !== tag.digest);
      if (wouldEvict(others, loaded !== undefined, tag.size, deps.totalMemBytes)) {
        throw new IpcError('ai_would_evict', aiCopy.errors.ai_would_evict(model));
      }
      const runtime = chooseRuntime({ loaded, lowResource: settings.lowResource, now: now() });
      const built = buildMessages(action, voiceProfile, sources, runtime.promptCtx);
      if (!built) throw new IpcError('ai_input_too_long', aiCopy.errors.ai_input_too_long);
      const spec = outputSpecFor(action);
      const { value } = await runStructured({
        client: c,
        model,
        disableThinking: thinking,
        messages: built.messages,
        spec,
        signal,
        attemptTimeoutMs: settings.timeoutSec * 1000,
        numCtx: runtime.numCtx,
        keepAlive: runtime.keepAlive,
        onProgress: onFields ? ({ attempt, fields, chars }) => onFields(attempt, fields, chars) : undefined,
      });
      return { fields: value, trimmed: built.trimmed };
    } catch (err) {
      if (isCancellation(err) || err instanceof IpcError) throw err;
      throw toIpcError(err, { phase: 'generate', model }, settings.endpoint);
    }
  }

  return {
    state: snapshot,
    probe,

    async selectModel(model: string | null): Promise<AiState> {
      if (model !== null) {
        await probe('force');
        const found = findModel(models, model);
        if (!found) throw new IpcError('model_needed', aiCopy.errors.model_needed);
        if (found.verdict === 'remote') throw new IpcError('remote_refused', aiCopy.errors.remote_refused(found.name));
        if (found.verdict === 'unverifiable') throw new IpcError('model_unverifiable', aiCopy.errors.model_unverifiable(found.name));
        if (found.verdict !== 'local') throw new IpcError('model_needed', aiCopy.errors.model_needed);
        model = found.name;
      }
      deps.setModel(model);
      return publish();
    },

    /** Generates suggestions. Resolves `cancelled` when cancelled or pre-empted; throws IpcError otherwise. */
    async generate(req: GenerateRequest): Promise<AiResult> {
      if (deps.isPreview) throw new IpcError('ai_preview', aiCopy.errors.ai_preview);
      if (req.sources.every((s) => s.text.trim() === '')) throw new IpcError('ai_nothing_to_use', aiCopy.errors.ai_nothing_to_use);
      try {
        return await queue.enqueue(req.requestId, req.priority, async (signal): Promise<AiResult> => {
          setRunning({ requestId: req.requestId, action: req.action, priority: req.priority });
          try {
            const profile = voice.get();
            const sourceTexts = req.sources.map((s) => s.text);
            let lastSent = 0;
            let lastCount = -1;
            let lastAttempt = 0;
            const { fields, trimmed } = await run(req.action, req.sources, profile, signal, (attempt, partial, chars) => {
              const options = toOptions(req.action, partial, sourceTexts, profile.bannedPhrases);
              const t = now();
              if (options.length === lastCount && attempt === lastAttempt && t - lastSent < progressIntervalMs) return;
              lastSent = t;
              lastCount = options.length;
              lastAttempt = attempt;
              deps.emit('ai:progress', { requestId: req.requestId, attempt, options, chars });
            });
            return { status: 'done', options: toOptions(req.action, fields, sourceTexts, profile.bannedPhrases), trimmed };
          } finally {
            setRunning(null);
          }
        });
      } catch (err) {
        if (isCancellation(err)) return { status: 'cancelled' };
        throw err;
      }
    },

    cancel(requestId: string): void {
      queue.cancel(requestId);
    },

    async deriveStyleBrief(requestId: string): Promise<BriefResult> {
      if (deps.isPreview) throw new IpcError('ai_preview', aiCopy.errors.ai_preview);
      const profile = voice.get();
      if (profile.examples.length === 0) throw new IpcError('voice_no_examples', aiCopy.errors.voice_no_examples);
      try {
        return await queue.enqueue(requestId, 'interactive', async (signal): Promise<BriefResult> => {
          setRunning({ requestId, action: 'brief', priority: 'interactive' });
          try {
            const { fields } = await run('brief', [], profile, signal);
            return { status: 'done', brief: fields.brief ?? '' };
          } finally {
            setRunning(null);
          }
        });
      } catch (err) {
        if (isCancellation(err)) return { status: 'cancelled' };
        throw err;
      }
    },

    /** Starts downloading a suggested model; progress and the outcome arrive through `ai:state`. */
    pull(model: string): void {
      if (deps.isPreview) throw new IpcError('ai_preview', aiCopy.errors.ai_preview);
      if (!isCatalogModel(model)) throw new IpcError('pull_failed', aiCopy.errors.pull_failed('only the suggested models can be downloaded here'));
      if (pull?.active) throw new IpcError('ai_busy', aiCopy.errors.ai_busy);
      const settings = deps.getSettings();
      let c: OllamaClient;
      try {
        c = client(settings.endpoint);
      } catch (err) {
        throw toIpcError(err, { phase: 'pull', model }, settings.endpoint);
      }
      const controller = new AbortController();
      pullController = controller;
      pull = { model, percent: 0, status: 'starting', error: null, active: true };
      publish();
      const layers = new Map<string, { total: number; completed: number }>();
      let lastSent = 0;
      let lastPercent = 0;
      void c
        .pull(model, {
          signal: controller.signal,
          onLine(line) {
            if (line.digest && line.total) layers.set(line.digest, { total: line.total, completed: line.completed ?? 0 });
            let total = 0;
            let done = 0;
            for (const layer of layers.values()) {
              total += layer.total;
              done += Math.min(layer.completed, layer.total);
            }
            const percent = total > 0 ? Math.floor((done / total) * 100) : 0;
            pull = { model, percent, status: line.status ?? '', error: null, active: true };
            const t = now();
            if (t - lastSent >= PULL_PROGRESS_MS) {
              lastSent = t;
              deps.emit('ai:pull-progress', { model, percent, status: pull.status });
            }
            if (percent !== lastPercent) {
              lastPercent = percent;
              publish();
            }
          },
        })
        .then(
          async () => {
            pull = { model, percent: 100, status: 'success', error: null, active: false };
            await probe('force');
          },
          (err: unknown) => {
            const cancelled = isCancellation(err);
            if (!cancelled) deps.log.warn(`ai: pull ${model} failed`, err instanceof Error ? err.message : err);
            pull = {
              model,
              percent: pull?.percent ?? 0,
              status: cancelled ? 'cancelled' : 'error',
              error: cancelled ? null : toIpcError(err, { phase: 'pull', model }, settings.endpoint).message,
              active: false,
            };
          },
        )
        .finally(() => {
          if (pullController === controller) pullController = null;
          publish();
        });
    },

    cancelPull(): void {
      pullController?.abort(new OllamaError('aborted', 'Cancelled.'));
    },

    getVoice: (): VoiceProfile => voice.get(),
    saveVoice: (patch: VoicePatch): VoiceProfile => voice.save(patch),
    addExample: (text: string): VoiceProfile => voice.addExample(text),
    removeExample: (id: string): VoiceProfile => voice.removeExample(id),

    /** A setting under `ai.*` changed. */
    settingChanged(key: string): void {
      if (key === 'ai.endpoint') {
        // Work aimed at the old endpoint stops, and results still on their way are dropped.
        queue.cancelAll();
        pullController?.abort(new OllamaError('aborted', 'Cancelled.'));
        probeGen += 1;
        inflight = null;
        shows.clear();
        void probe('force');
      } else if (key === 'ai.model' || key === 'ai.lowResource') {
        publish();
      }
    },

    dispose(): void {
      queue.cancelAll();
      pullController?.abort(new OllamaError('aborted', 'Cancelled.'));
      probeGen += 1;
    },
  };
}
