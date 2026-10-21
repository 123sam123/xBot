import type { ComponentType } from 'react';

// Onboarding steps. Each is a file in ./steps/ whose default export is an
// OnboardingStep; this module collects them at build time, so a ticket adds
// its step (check Ollama, pick a model, folders, X, reminder hours) by adding
// a file and edits nothing shared. A step shows once: its id is stored in the
// `ui.onboardingSeen` setting when the user moves past it or skips.

export interface OnboardingStepProps {
  /** Moves past this step (to the next one, or closes the sheet after the last). */
  next(): void;
  /** Skips the rest of onboarding. */
  skip(): void;
  isLast: boolean;
}

export interface OnboardingStep {
  /** Unique and stable: it is stored once seen. */
  id: string;
  /** Steps sort by `order`, then `id`. Welcome is 0; suggested: Ollama 10, model 20, folders 30, X 40, reminders 50. */
  order: number;
  /** The sheet's title while this step shows. */
  title: string;
  /** The step's content. The sheet adds Skip and the primary Continue / Start writing button. */
  Component: ComponentType<OnboardingStepProps>;
}

const modules = import.meta.glob<{ default: OnboardingStep }>('./steps/*.tsx', { eager: true });

export const onboardingSteps: readonly OnboardingStep[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export function unseenSteps(seen: readonly string[]): OnboardingStep[] {
  return onboardingSteps.filter((step) => !seen.includes(step.id));
}
