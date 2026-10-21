import { useState } from 'react';
import { FrostedButton, GhostButton, Sheet } from '../design-system';
import type { OnboardingStep } from './registry';

/**
 * Shows `steps` in order. `onSeen` receives the ids to store as seen: the
 * current step when the user moves past it, every step of this run on Skip,
 * the close button or Escape. `onDone` runs when the sheet closes either way.
 */
export function OnboardingSheet({
  open,
  steps,
  onSeen,
  onDone,
}: {
  open: boolean;
  steps: readonly OnboardingStep[];
  onSeen(ids: string[]): void;
  onDone(finished: boolean): void;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  if (!step) return null;
  const isLast = index === steps.length - 1;

  const next = () => {
    onSeen([step.id]);
    if (isLast) onDone(true);
    else setIndex(index + 1);
  };
  const skip = () => {
    onSeen(steps.map((s) => s.id));
    onDone(false);
  };
  const { Component } = step;

  return (
    <Sheet open={open} title={step.title} onClose={skip} testId="onboarding-sheet">
      <Component next={next} skip={skip} isLast={isLast} />
      <div className="onboarding-actions">
        {steps.length > 1 && (
          <span className="onboarding-progress">
            {index + 1} of {steps.length}
          </span>
        )}
        <GhostButton className="onboarding-skip" onClick={skip}>
          Skip
        </GhostButton>
        <FrostedButton className="onboarding-next" onClick={next}>
          {isLast ? 'Start writing' : 'Continue'}
        </FrostedButton>
      </div>
    </Sheet>
  );
}
