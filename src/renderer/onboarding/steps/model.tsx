import { aiCopy } from '../../../shared/aiCopy';
import { chipFor, ModelPicker, useAiState } from '../../composer/ai';
import { StatusChip } from '../../design-system';
import type { OnboardingStep } from '../registry';

// Onboarding step 3 (T6): use an installed local model, or download one
// sized for this Mac. Nothing downloads without a click on Download.
function ChooseModel() {
  const { state } = useAiState();
  const chip = chipFor(state);
  return (
    <div className="ai-step">
      <div className="ai-check-status">
        <StatusChip tone={chip.tone === 'warning' ? 'warning' : 'neutral'}>
          {chip.tone === 'ok' && <span className="status-dot status-dot-ok" aria-hidden="true" />}
          {chip.label}
        </StatusChip>
      </div>
      <p className="ai-guidance">{state?.guidance ?? aiCopy.guidance.checking}</p>
      <ModelPicker state={state} />
      <p className="sheet-note">{aiCopy.honestCost}</p>
    </div>
  );
}

const step: OnboardingStep = { id: 'model', order: 20, title: 'Choose a model', Component: ChooseModel };
export default step;
