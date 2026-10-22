import { aiCopy } from '../../../shared/aiCopy';
import type { AiState } from '../../../shared/contracts/ai';
import type { IntegrationStatus } from '../../../shared/contracts/app';

/** The `ai` status chip: "Local AI ready", "Ollama not running" or "Model needed" (and busy states). */
export function statusFor(state: AiState): IntegrationStatus {
  const chip = aiCopy.chip;
  if (state.pull?.active) return { id: 'ai', label: chip.downloading(state.pull.model, state.pull.percent), tone: 'busy' };
  switch (state.phase) {
    case 'checking':
      return { id: 'ai', label: chip.checking, tone: 'busy' };
    case 'ready':
      return { id: 'ai', label: chip.ready, tone: 'ok', detail: state.selected ?? undefined };
    case 'not_running':
      return { id: 'ai', label: chip.notRunning, tone: 'warning', detail: state.probeError?.message ?? chip.notRunningDetail };
    case 'model_needed':
      return { id: 'ai', label: chip.modelNeeded, tone: 'warning', detail: state.guidance };
  }
}
