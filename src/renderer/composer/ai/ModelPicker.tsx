import { useState, type CSSProperties } from 'react';
import { aiCopy } from '../../../shared/aiCopy';
import type { AiModel, AiState, CatalogEntry } from '../../../shared/contracts/ai';
import { CheckIcon, cx, GhostButton, StatusChip, Tooltip } from '../../design-system';

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

/**
 * Installed models (only local ones can be chosen) and a short list of
 * verified downloads sized for this Mac. A download starts only from its
 * Download button, shows progress, and can be cancelled and retried.
 */
export function ModelPicker({ state }: { state: AiState | null }) {
  const [error, setError] = useState<string | null>(null);
  if (!state || state.phase === 'checking') return null;
  if (state.phase === 'not_running') return <p className="sheet-note">Your models show here once Ollama is running.</p>;

  const select = async (model: string | null) => {
    setError(null);
    const result = await window.xbot.ai.selectModel(model);
    if (!result.ok) setError(result.error.message);
  };
  const download = async (model: string) => {
    setError(null);
    const result = await window.xbot.ai.pull(model);
    if (!result.ok) setError(result.error.message);
  };
  const downloads = state.recommendations.filter((entry) => !entry.installed);
  const pullActive = state.pull?.active ?? false;

  return (
    <div className="ai-models">
      {state.models.length > 0 && (
        <div className="ai-model-list" role="radiogroup" aria-label="Installed models">
          {state.models.map((model) => (
            <InstalledModel key={model.name} model={model} selected={model.name === state.selected} onSelect={() => void select(model.name)} />
          ))}
          {state.selectedByUser && (
            <GhostButton className="ai-status-action ai-auto" onClick={() => void select(null)}>
              Pick automatically
            </GhostButton>
          )}
        </div>
      )}

      {downloads.length > 0 && (
        <div className="ai-downloads">
          <p className="sheet-note">
            {state.models.length > 0 ? 'Or download one sized for this Mac.' : 'Download one sized for this Mac.'} {aiCopy.offline}
          </p>
          {downloads.map((entry) => (
            <Download
              key={entry.name}
              entry={entry}
              pull={state.pull?.model === entry.name ? state.pull : null}
              otherActive={pullActive && state.pull?.model !== entry.name}
              onDownload={() => void download(entry.name)}
            />
          ))}
        </div>
      )}

      {error && (
        <StatusChip tone="warning" className="ai-apply-error">
          {error}
        </StatusChip>
      )}
    </div>
  );
}

function InstalledModel({ model, selected, onSelect }: { model: AiModel; selected: boolean; onSelect(): void }) {
  const usable = model.verdict === 'local';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={!usable || undefined}
      className={cx('ai-model', selected && 'ai-model-selected')}
      data-testid="ai-model"
      onClick={() => usable && !selected && onSelect()}
    >
      <span className="ai-model-text">
        <span className="ai-model-name">{model.name}</span>
        <span className="ai-model-detail">
          {[model.parameterSize, gb(model.sizeBytes), model.reason].filter(Boolean).join(' · ')}
        </span>
      </span>
      {selected && usable && <CheckIcon size={16} />}
    </button>
  );
}

function Download({
  entry,
  pull,
  otherActive,
  onDownload,
}: {
  entry: CatalogEntry;
  pull: AiState['pull'];
  otherActive: boolean;
  onDownload(): void;
}) {
  const button = (
    <GhostButton className="ai-status-action" data-testid="ai-download" disabled={otherActive} onClick={onDownload}>
      {pull?.error ? 'Retry' : 'Download'}
    </GhostButton>
  );
  return (
    <div className="ai-download" data-model={entry.name}>
      <span className="ai-model-text">
        <span className="ai-model-name">
          {entry.name}
          {entry.recommended && <span className="badge ai-badge">Recommended</span>}
        </span>
        <span className="ai-model-detail">
          {entry.sizeLabel} download · {entry.note}
        </span>
        {pull?.active && (
          <span className="ai-progress" role="progressbar" aria-label={`Downloading ${entry.name}`} aria-valuenow={pull.percent} aria-valuemin={0} aria-valuemax={100}>
            <span className="ai-progress-fill" style={{ '--progress': `${pull.percent}%` } as CSSProperties} />
          </span>
        )}
        {pull?.active && <span className="ai-model-detail">{pull.percent}% · {pull.status}</span>}
        {pull?.error && <span className="ai-model-detail ai-status-error">{pull.error}</span>}
      </span>
      {pull?.active ? (
        <GhostButton className="ai-status-action" onClick={() => void window.xbot.ai.cancelPull()}>
          Cancel
        </GhostButton>
      ) : otherActive ? (
        <Tooltip label="Another download is running">{button}</Tooltip>
      ) : (
        button
      )}
    </div>
  );
}
