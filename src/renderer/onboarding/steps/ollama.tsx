import { aiCopy } from '../../../shared/aiCopy';
import { CloudOffNote, OllamaCheck, useAiState } from '../../composer/ai';
import type { OnboardingStep } from '../registry';

// Onboarding step 2 (T6): is local Ollama there? With Ollama stopped it
// explains what to do and moves on; writing never waits for it.
function CheckOllama() {
  const { state, refresh } = useAiState();
  return (
    <div className="ai-step">
      <p className="onboarding-text">xBot’s AI suggestions run only on this Mac, through Ollama. Writing and media work without it.</p>
      <OllamaCheck state={state} refresh={refresh} />
      <CloudOffNote />
      <p className="sheet-note">{aiCopy.honestCost}</p>
    </div>
  );
}

const step: OnboardingStep = { id: 'ollama', order: 10, title: 'Check local Ollama', Component: CheckOllama };
export default step;
