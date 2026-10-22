import { useState } from 'react';
import { ideaCopy } from '../../../shared/ideaCopy';
import { pickFolders, useProjects } from '../../composer/ideas';
import { GhostButton, PlusIcon, StatusChip } from '../../design-system';
import type { OnboardingStep } from '../registry';

// Onboarding step 4 (T7): optionally choose the folders xBot may read for
// post ideas. The picker is the native one, run by main; skipping is fine.
function ChooseFolders() {
  const projects = useProjects() ?? [];
  const [messages, setMessages] = useState<{ tone: 'neutral' | 'warning'; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    setBusy(true);
    try {
      setMessages(await pickFolders());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ideas-step">
      <p className="onboarding-text">Pick the folders you build in, and xBot suggests posts from their README, docs and commit messages. You can skip this and add them later under Ideas.</p>
      <p className="sheet-note">{ideaCopy.privacy}</p>
      <div className="projects-add">
        <GhostButton className="ai-status-action" icon={<PlusIcon size={16} />} disabled={busy} data-testid="onboarding-folders" onClick={() => void choose()}>
          Choose folders…
        </GhostButton>
      </div>
      {messages.map((m, index) => (
        <StatusChip key={index} tone={m.tone === 'warning' ? 'warning' : undefined} className="projects-message">
          {m.text}
        </StatusChip>
      ))}
      {projects.length > 0 && (
        <ul className="ideas-step-list">
          {projects.map((p) => (
            <li key={p.id}>
              {p.name} <span>{p.displayPath}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const step: OnboardingStep = { id: 'projects', order: 30, title: 'Project folders (optional)', Component: ChooseFolders };
export default step;
