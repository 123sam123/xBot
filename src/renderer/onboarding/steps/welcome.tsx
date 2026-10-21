import type { OnboardingStep } from '../registry';

function Welcome() {
  return (
    <div className="onboarding-welcome">
      <p className="onboarding-lede">Share what you’re building.</p>
      <p className="onboarding-text">
        Write a post and add screenshots or a clip right away. Local AI and your X account are optional, and you can set them up whenever you like.
      </p>
    </div>
  );
}

const step: OnboardingStep = { id: 'welcome', order: 0, title: 'Welcome to xBot', Component: Welcome };
export default step;
