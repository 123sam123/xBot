import { useState } from 'react';
import { aiCopy } from '../../../shared/aiCopy';
import type { AiState } from '../../../shared/contracts/ai';
import { GhostButton, StatusChip } from '../../design-system';

/** The chip text for a state; main's status registry shows the same words. */
export function chipFor(state: AiState | null): { label: string; tone: 'ok' | 'warning' | 'busy' } {
  if (!state || state.phase === 'checking') return { label: aiCopy.chip.checking, tone: 'busy' };
  if (state.phase === 'ready') return { label: aiCopy.chip.ready, tone: 'ok' };
  if (state.phase === 'not_running') return { label: aiCopy.chip.notRunning, tone: 'warning' };
  return { label: aiCopy.chip.modelNeeded, tone: 'warning' };
}

/**
 * Is local Ollama reachable, and what to do about it: the status, the
 * guidance for this state, "Check again", and the install link when Ollama
 * isn't running. Works the same with Ollama stopped: nothing here blocks
 * writing.
 */
export function OllamaCheck({ state, refresh }: { state: AiState | null; refresh(mode: 'force'): Promise<void> }) {
  const [checking, setChecking] = useState(false);
  const chip = chipFor(state);
  const check = async () => {
    setChecking(true);
    try {
      await refresh('force');
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="ai-check" data-testid="ollama-check" data-phase={state?.phase ?? 'checking'}>
      <div className="ai-check-status">
        <StatusChip tone={chip.tone === 'warning' ? 'warning' : 'neutral'}>
          {chip.tone === 'ok' && <span className="status-dot status-dot-ok" aria-hidden="true" />}
          {chip.tone === 'busy' && <span className="status-dot status-dot-busy" aria-hidden="true" />}
          {chip.label}
        </StatusChip>
        <GhostButton className="ai-status-action" aria-busy={checking || undefined} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check again'}
        </GhostButton>
      </div>
      <p className="ai-guidance" data-testid="ollama-guidance">
        {state?.guidance ?? aiCopy.guidance.checking}
      </p>
      {state?.phase === 'not_running' && !state.probeError && (
        <a className="ai-link" data-testid="ollama-install" href={aiCopy.installUrl} target="_blank" rel="noreferrer">
          Install Ollama from ollama.com ↗
        </a>
      )}
      {state?.version && (
        <p className="sheet-note">
          Ollama {state.version} at {state.endpoint}
          {state.cloudDisabled === true ? ' · cloud features off' : state.cloudDisabled === false ? ' · cloud features on' : ''}
        </p>
      )}
    </div>
  );
}

/** How to switch Ollama's cloud features off. xBot never changes Ollama's configuration itself. */
export function CloudOffNote() {
  return (
    <details className="ai-details">
      <summary>Keep Ollama local-only</summary>
      <p className="sheet-note">{aiCopy.cloudOffIntro}</p>
      <code className="ai-code">{aiCopy.cloudOffConfig}</code>
      <p className="sheet-note">{aiCopy.cloudOffAlternative}</p>
      <p className="sheet-note">{aiCopy.cloudOffOutro}</p>
    </details>
  );
}
