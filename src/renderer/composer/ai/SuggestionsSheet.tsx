import { useId, useState } from 'react';
import { aiCopy } from '../../../shared/aiCopy';
import type { AiAngle, AiOption, AiState } from '../../../shared/contracts/ai';
import { FrostedButton, GhostButton, Sheet, SparkleIcon, StatusChip, Tooltip } from '../../design-system';
import { unavailableReason, type MenuContext } from './AiMenu';
import type { AiRun } from './useAiRun';

const ANGLES = Object.keys(aiCopy.angles) as AiAngle[];

const REWRITE_TITLES = { shorter: 'Shorter', casual: 'More casual', angle: 'Different angle', selection: 'Rewritten selection' } as const;

/**
 * Suggestions from local AI. "Suggest a post" asks what was built and fills
 * three cards (one per story angle) as each arrives; a rewrite shows its one
 * result. Closing the sheet never cancels a run, and nothing changes the
 * post until the user picks a suggestion.
 */
export function SuggestionsSheet({
  open,
  onClose,
  mode,
  run,
  state,
  context,
  draftText,
  onSuggest,
  onApply,
  onSetup,
}: {
  open: boolean;
  onClose(): void;
  mode: 'story' | 'rewrite';
  run: AiRun;
  state: AiState | null;
  context: MenuContext;
  draftText: string;
  onSuggest(): void;
  /** Applies a suggestion; resolves to an error message, or null once applied. */
  onApply(option: AiOption, target: 'whole' | 'selection'): string | null;
  onSetup(): void;
}) {
  return (
    <Sheet open={open} title="Suggestions" onClose={onClose} testId="ai-sheet">
      <SuggestionsBody
        mode={mode}
        run={run}
        state={state}
        context={context}
        draftText={draftText}
        onSuggest={onSuggest}
        onApply={onApply}
        onSetup={onSetup}
      />
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so an apply error starts fresh each time. */
function SuggestionsBody({
  mode,
  run,
  state,
  context,
  draftText,
  onSuggest,
  onApply,
  onSetup,
}: {
  mode: 'story' | 'rewrite';
  run: AiRun;
  state: AiState | null;
  context: MenuContext;
  draftText: string;
  onSuggest(): void;
  onApply(option: AiOption, target: 'whole' | 'selection'): string | null;
  onSetup(): void;
}) {
  const noteId = useId();
  const [applyError, setApplyError] = useState<string | null>(null);
  const showingStory = mode === 'story';
  const resultsBelong = showingStory ? run.action === 'story' : run.action !== null && run.action !== 'story';
  const options = resultsBelong ? run.options : [];

  const suggestReason =
    unavailableReason('story', state, context) ?? (draftText.trim() === '' && run.note.trim() === '' ? aiCopy.errors.ai_nothing_to_use : null);
  const apply = (option: AiOption, target: 'whole' | 'selection') => setApplyError(onApply(option, target));
  const applyDisabled = !context.draftLoaded;

  const suggest = (
    <FrostedButton className="ai-suggest" data-testid="ai-suggest" disabled={suggestReason !== null} onClick={onSuggest}>
      Suggest
    </FrostedButton>
  );

  return (
    <>
      {showingStory && (
        <div className="ai-note">
          <label htmlFor={noteId} className="ai-label">
            What did you build today?
          </label>
          <textarea
            id={noteId}
            className="ai-textarea"
            data-testid="ai-note"
            rows={3}
            maxLength={1000}
            value={run.note}
            placeholder="One sentence is enough. Your draft is used too."
            onChange={(event) => run.setNote(event.target.value)}
          />
          <div className="ai-note-actions">{suggestReason ? <Tooltip label={suggestReason}>{suggest}</Tooltip> : suggest}</div>
        </div>
      )}

      {resultsBelong && run.running && (
        <div className="ai-running" role="status" data-testid="ai-running">
          <SparkleIcon size={16} className="ai-status-busy" />
          <span>{run.attempt > 1 ? 'Retrying… the first answer didn’t fit.' : `Running locally${state?.selected ? ` · ${state.selected}` : ''}`}</span>
          <GhostButton className="ai-status-action" onClick={run.cancel}>
            Cancel
          </GhostButton>
        </div>
      )}

      {resultsBelong && run.error && !run.running && (
        <div className="ai-error" role="alert">
          <span>{run.error.message}</span>
          <GhostButton className="ai-status-action" onClick={run.retry}>
            Try again
          </GhostButton>
          <GhostButton className="ai-status-action" onClick={onSetup}>
            Set up…
          </GhostButton>
        </div>
      )}

      {showingStory ? (
        <div className="ai-cards">
          {ANGLES.map((angle) => (
            <SuggestionCard
              key={angle}
              title={aiCopy.angles[angle]}
              option={options.find((o) => o.angle === angle)}
              waiting={resultsBelong && run.running}
              actionLabel="Use this"
              disabled={applyDisabled}
              onApply={(option) => apply(option, 'whole')}
            />
          ))}
        </div>
      ) : (
        run.action &&
        run.action !== 'story' && (
          <div className="ai-cards">
            <SuggestionCard
              title={REWRITE_TITLES[run.action]}
              option={options[0]}
              waiting={run.running}
              actionLabel={run.action === 'selection' ? 'Replace selection' : 'Replace'}
              disabled={applyDisabled}
              onApply={(option) => apply(option, run.action === 'selection' ? 'selection' : 'whole')}
            />
          </div>
        )
      )}

      {applyError && (
        <StatusChip tone="warning" className="ai-apply-error">
          {applyError}
        </StatusChip>
      )}
      {resultsBelong && run.trimmed && <p className="sheet-note">Only the start of a long text fit this model’s context.</p>}
      <p className="sheet-note">{aiCopy.honestCost}</p>
    </>
  );
}

function SuggestionCard({
  title,
  option,
  waiting,
  actionLabel,
  disabled,
  onApply,
}: {
  title: string;
  option: AiOption | undefined;
  waiting: boolean;
  actionLabel: string;
  disabled: boolean;
  onApply(option: AiOption): void;
}) {
  return (
    <article className="ai-card" data-testid="ai-card" aria-busy={waiting && !option ? true : undefined}>
      <h3 className="ai-card-title">{title}</h3>
      {option ? <p className="ai-card-text">{option.text}</p> : <p className="ai-card-placeholder">{waiting ? 'Writing…' : 'Not written yet.'}</p>}
      {option && (
        <>
          <div className="ai-card-flags">
            {option.flags.numbers.length > 0 && <StatusChip tone="warning">Confirm {option.flags.numbers.join(', ')}</StatusChip>}
            {option.flags.phrases.length > 0 && <StatusChip tone="warning">Sounds generic: {option.flags.phrases.join(', ')}</StatusChip>}
            {option.flags.hashtagsStripped.length > 0 && <span className="ai-card-note">Removed {option.flags.hashtagsStripped.join(' ')}</span>}
          </div>
          <div className="ai-card-actions">
            <FrostedButton className="ai-use" disabled={disabled} onClick={() => onApply(option)}>
              {actionLabel}
            </FrostedButton>
          </div>
        </>
      )}
    </article>
  );
}
