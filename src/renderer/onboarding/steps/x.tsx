import { XSetup } from '../../composer/account/XSetup';
import type { OnboardingStep } from '../registry';

/** Onboarding step 5: optionally connect X. Skippable; Settings → X has the same setup later. */
function ConnectX() {
  return <XSetup variant="onboarding" />;
}

const step: OnboardingStep = { id: 'x', order: 40, title: 'Connect X (optional)', Component: ConnectX };
export default step;
