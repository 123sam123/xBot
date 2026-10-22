import { aiCopy } from '../../../shared/aiCopy';
import type { ModelVerdict } from '../../../shared/contracts/ai';
import type { OllamaShow, OllamaTag } from './ollamaClient';

// Whether a model provably runs on this Mac (docs/OLLAMA.md → "Locality").
// Only `local` models generate; anything xBot cannot establish is
// `unverifiable`. Reads metadata only: xBot never touches ~/.ollama.

/** A cloud model's manifest is a stub of a few hundred bytes; real weights are hundreds of MB. */
export const MIN_LOCAL_MODEL_BYTES = 50 * 1024 * 1024;

/**
 * Ollama's own cloud-routing rule (internal/modelref.parseSourceSuffix): the
 * part after the last `:`, trimmed and lowercased, is `cloud`, or ends in
 * `-cloud` and contains no `/`. `gemma4:cloud`, `gpt-oss:120b-cloud`.
 */
export function isCloudName(name: string): boolean {
  const index = name.lastIndexOf(':');
  if (index < 0) return false;
  const raw = name.slice(index + 1).trim();
  const suffix = raw.toLowerCase();
  if (suffix === 'cloud') return true;
  return !raw.includes('/') && suffix.endsWith('-cloud');
}

function hasRemoteFields(meta: { remote_host?: string; remote_model?: string } | null): boolean {
  return Boolean(meta && ((meta.remote_host ?? '') !== '' || (meta.remote_model ?? '') !== ''));
}

export interface Assessment {
  verdict: ModelVerdict;
  reason: string;
}

/** `show` is null when /api/show failed for this model. */
export function assessModel(tag: OllamaTag, show: OllamaShow | null): Assessment {
  if (hasRemoteFields(tag) || hasRemoteFields(show) || isCloudName(tag.name)) {
    return { verdict: 'remote', reason: aiCopy.verdicts.remote };
  }
  if (!show) return { verdict: 'unverifiable', reason: aiCopy.verdicts.noShow };
  if (!Array.isArray(show.capabilities)) return { verdict: 'unverifiable', reason: aiCopy.verdicts.noCapabilities };
  if (tag.size < MIN_LOCAL_MODEL_BYTES) return { verdict: 'unverifiable', reason: aiCopy.verdicts.tooSmall };
  // Embedding-only models have `embedding` and no `completion`.
  if (!show.capabilities.includes('completion')) return { verdict: 'unsuitable', reason: aiCopy.verdicts.noCompletion };
  return { verdict: 'local', reason: aiCopy.verdicts.local };
}
