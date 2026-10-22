import type { OllamaPsModel } from './ollamaClient';

// How long Ollama keeps the model, and with what context, for one action
// (docs/OLLAMA.md → "Memory hygiene"). `/api/ps` is read once per action, so
// a retry never mistakes xBot's own load for other work. A model other work
// already loaded keeps its remaining time and its context window: a shorter
// keep-alive would unload it early, and a different `num_ctx` would reload it.

export const OWN_CONTEXT = 4096;
export const LOW_RESOURCE_CONTEXT = 2048;
const DEFAULT_KEEP_SECONDS = 300;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
/** Ollama's default OLLAMA_MAX_LOADED_MODELS on CPU and Apple Silicon. */
export const MAX_LOADED_MODELS = 3;

export interface Runtime {
  keepAlive: string | number;
  /** Sent as `options.num_ctx`. */
  numCtx: number;
  /** The window the prompt must fit in: xBot's own, or the loaded runner's if smaller. */
  promptCtx: number;
  loadedBefore: boolean;
}

/** `loaded` is the selected model's /api/ps entry (matched by digest), if it was already running. */
export function chooseRuntime({ loaded, lowResource, now }: { loaded: OllamaPsModel | undefined; lowResource: boolean; now: number }): Runtime {
  const own = lowResource ? LOW_RESOURCE_CONTEXT : OWN_CONTEXT;
  if (!loaded) {
    return { keepAlive: lowResource ? 0 : '5m', numCtx: own, promptCtx: own, loadedBefore: false };
  }
  const expires = loaded.expires_at ? Date.parse(loaded.expires_at) : Number.NaN;
  let keepAlive: string | number;
  if (Number.isFinite(expires) && expires - now > YEAR_MS) {
    keepAlive = -1; // loaded "forever" by other work: keep it that way
  } else {
    const remaining = Number.isFinite(expires) ? Math.ceil((expires - now) / 1000) : 0;
    // A stale expires_at (another request is running) can be in the past. Never send ≤ 0:
    // 0 would unload someone else's model, and a negative value means "keep forever".
    if (remaining <= 0) keepAlive = `${DEFAULT_KEEP_SECONDS}s`;
    else keepAlive = `${lowResource ? remaining : Math.max(remaining, DEFAULT_KEEP_SECONDS)}s`;
  }
  const runnerCtx = loaded.context_length;
  return {
    keepAlive,
    numCtx: runnerCtx ?? own,
    promptCtx: runnerCtx ? Math.min(own, runnerCtx) : own,
    loadedBefore: true,
  };
}

/**
 * True when loading `modelBytes` now could make Ollama unload other work's
 * models: 3 or more are loaded already, or they plus this one would take more
 * than 75% of RAM. A heuristic (docs/OLLAMA.md → "Known limits").
 */
export function wouldEvict(running: readonly OllamaPsModel[], selectedLoaded: boolean, modelBytes: number, totalMemBytes: number): boolean {
  if (selectedLoaded || running.length === 0) return false;
  if (running.length >= MAX_LOADED_MODELS) return true;
  const inUse = running.reduce((sum, m) => sum + m.size, 0);
  return inUse + modelBytes * 1.2 > totalMemBytes * 0.75;
}
