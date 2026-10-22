import { useEffect, useId, useRef, useState } from 'react';
import { ideaCopy } from '../../../shared/ideaCopy';
import type { AiState } from '../../../shared/contracts/ai';
import type { Idea, IdeasState, ProjectSummary } from '../../../shared/contracts/projects';
import { FrostedButton, GhostButton, IconButton, LightbulbIcon, Popover, popovers, SparkleIcon, StatusChip, usePopoverOpen } from '../../design-system';

export const IDEAS_POPOVER = 'ideas';
const NOTE_MAX = 500;

/**
 * The header's Ideas entry: a small bulb (with a dot when there are new
 * ideas) and its popover. Opening it asks main for ideas from activity no
 * generation has used yet, in the background, so an unchanged history costs
 * nothing. Nothing touches the post until the user picks Use. Preview mode
 * (T10) lists its seeded sample idea, labelled, and finds no new ones.
 */
export function IdeasMenu({
  state,
  projects,
  aiState,
  preview,
  onUse,
  onProjects,
  onAiSetup,
}: {
  state: IdeasState | null;
  projects: readonly ProjectSummary[];
  aiState: AiState | null;
  preview: boolean;
  /** Puts the idea's text in the draft; resolves to an error message, or null once applied. */
  onUse(idea: Idea): string | null;
  onProjects(): void;
  onAiSetup(): void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const open = usePopoverOpen(IDEAS_POPOVER);
  const count = state?.ideas.length ?? 0;

  useEffect(() => {
    if (open && !preview) void window.xbot.projects.refreshIdeas('auto');
  }, [open, preview]);

  return (
    <>
      <IconButton
        ref={anchor}
        label={count > 0 ? `Ideas (${count} new)` : 'Ideas'}
        size="sm"
        bare
        className="ideas-trigger"
        data-testid="ideas-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => popovers.toggle(IDEAS_POPOVER)}
      >
        <LightbulbIcon size={20} />
        {count > 0 && <span className="ideas-dot" aria-hidden="true" />}
      </IconButton>
      <Popover id={IDEAS_POPOVER} anchor={anchor} placement="bottom-end" label="Ideas" className="ideas-popover" testId="ideas-popover">
        <IdeasBody state={state} projects={projects} aiState={aiState} preview={preview} onUse={onUse} onProjects={onProjects} onAiSetup={onAiSetup} />
      </Popover>
    </>
  );
}

function IdeasBody({
  state,
  projects,
  aiState,
  preview,
  onUse,
  onProjects,
  onAiSetup,
}: {
  state: IdeasState | null;
  projects: readonly ProjectSummary[];
  aiState: AiState | null;
  preview: boolean;
  onUse(idea: Idea): string | null;
  onProjects(): void;
  onAiSetup(): void;
}) {
  const [useError, setUseError] = useState<string | null>(null);
  const sample = preview || (state?.preview ?? false);
  const ideas = state?.ideas ?? [];
  const running = state?.running ?? null;
  const aiBlocked = aiState && aiState.phase !== 'ready' && aiState.phase !== 'checking' ? aiState.guidance : null;
  const empty = ideas.length === 0;

  const close = () => popovers.close(IDEAS_POPOVER);
  const use = (idea: Idea) => {
    const error = onUse(idea);
    setUseError(error);
    if (error === null) {
      void window.xbot.projects.useIdea(idea.id);
      close();
    }
  };

  return (
    <>
      <header className="ideas-head">
        <h2 className="ideas-title">Ideas</h2>
        {!sample && (
          <GhostButton
            className="ideas-refresh"
            data-testid="ideas-refresh"
            disabled={running !== null || aiBlocked !== null}
            onClick={() => void window.xbot.projects.refreshIdeas('force')}
          >
            Refresh ideas
          </GhostButton>
        )}
      </header>
      {sample && (
        <p className="sheet-note" data-testid="ideas-preview-note">
          A preview sample. Finding new ideas is off in preview.
        </p>
      )}

      {running && (
        <div className="ai-running" role="status" data-testid="ideas-running">
          <SparkleIcon size={16} className="ai-status-busy" />
          <span>Finding stories locally{running.projectName ? ` in ${running.projectName}` : ''}…</span>
          <GhostButton className="ai-status-action" onClick={() => void window.xbot.projects.cancelIdeas()}>
            Cancel
          </GhostButton>
        </div>
      )}

      {!running && (aiBlocked || state?.error) && (
        <div className="ai-error" role="alert">
          <span>{aiBlocked ?? state?.error?.message}</span>
          {!aiBlocked && (
            <GhostButton className="ai-status-action" onClick={() => void window.xbot.projects.refreshIdeas('force')}>
              Try again
            </GhostButton>
          )}
          <GhostButton
            className="ai-status-action"
            onClick={() => {
              close();
              onAiSetup();
            }}
          >
            Set up…
          </GhostButton>
        </div>
      )}

      {useError && (
        <StatusChip tone="warning" className="ai-apply-error">
          {useError}
        </StatusChip>
      )}

      {ideas.length > 0 && (
        <div className="ai-cards ideas-list">
          {ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} onUse={() => use(idea)} onDismiss={() => void window.xbot.projects.dismissIdea(idea.id)} />
          ))}
        </div>
      )}

      {empty && !running && !sample && projects.length === 0 && !state?.needsContext && (
        <p className="ideas-empty">Add a project folder and xBot suggests posts from its commits and docs, or just tell it what you built.</p>
      )}
      {empty && !running && state?.needsContext && (
        <p className="ideas-empty" data-testid="ideas-needs-context">
          Nothing new to go on yet.
        </p>
      )}

      {!sample && <NoteField projects={projects} askForContext={empty && !running && (state?.needsContext ?? false)} disabled={running !== null} />}

      <footer className="ideas-foot">
        <GhostButton
          className="ideas-projects"
          data-testid="ideas-projects"
          onClick={() => {
            close();
            onProjects();
          }}
        >
          {projects.length === 0 ? 'Add project folders…' : `Projects (${projects.length})…`}
        </GhostButton>
        <span className="ideas-local">Runs on this Mac</span>
      </footer>
    </>
  );
}

function IdeaCard({ idea, onUse, onDismiss }: { idea: Idea; onUse(): void; onDismiss(): void }) {
  const unconfirmed = idea.claims.filter((c) => !c.confirmed);
  const confirmed = idea.claims.filter((c) => c.confirmed);
  return (
    <article className="ai-card idea-card" data-testid="idea-card">
      <h3 className="ai-card-title">
        {ideaCopy.kinds[idea.kind]}
        {idea.projectName && <span className="idea-project"> · {idea.projectName}</span>}
      </h3>
      <p className="ai-card-text">{idea.text}</p>
      {unconfirmed.length > 0 && (
        <div className="idea-confirm" data-testid="idea-confirm">
          <StatusChip tone="warning">Confirm before posting</StatusChip>
          <ul className="idea-claims">
            {unconfirmed.map((claim) => (
              <li key={claim.text}>
                <span className="idea-claim-text">{claim.text}</span>
                {claim.reason && <span className="idea-claim-reason"> · {claim.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(idea.flags.phrases.length > 0 || idea.flags.hashtagsStripped.length > 0) && (
        <div className="ai-card-flags">
          {idea.flags.phrases.length > 0 && <StatusChip tone="warning">Sounds generic: {idea.flags.phrases.join(', ')}</StatusChip>}
          {idea.flags.hashtagsStripped.length > 0 && <span className="ai-card-note">Removed {idea.flags.hashtagsStripped.join(' ')}</span>}
        </div>
      )}
      <details className="idea-why" data-testid="idea-why">
        <summary>Why this suggestion?</summary>
        <ul className="idea-sources">
          {idea.sources.map((source, index) => (
            <li key={index}>
              <span className="idea-source-kind">{ideaCopy.sources[source.kind]}</span>
              <span className="idea-source-label">{source.label}</span>
            </li>
          ))}
          {confirmed.map((claim) => (
            <li key={`c-${claim.text}`}>
              <span className="idea-source-kind">Confirmed</span>
              <span className="idea-source-label">{claim.text}</span>
            </li>
          ))}
        </ul>
      </details>
      <div className="ai-card-actions idea-actions">
        <GhostButton className="ai-status-action" data-testid="idea-dismiss" onClick={onDismiss}>
          Dismiss
        </GhostButton>
        <FrostedButton className="ai-use" data-testid="idea-use" onClick={onUse}>
          Use
        </FrostedButton>
      </div>
    </article>
  );
}

/** "What did you build today?": a note for a project (or none) that asks for ideas about it. */
function NoteField({ projects, askForContext, disabled }: { projects: readonly ProjectSummary[]; askForContext: boolean; disabled: boolean }) {
  const id = useId();
  const newest = [...projects].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))[0];
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState<string>(newest?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const target = projects.some((p) => p.id === projectId) ? projectId : (newest?.id ?? '');

  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed === '' || disabled) return;
    const result = await window.xbot.projects.addNote(target === '' ? null : target, trimmed);
    if (result.ok) {
      setText('');
      setError(null);
    } else {
      setError(result.error.message);
    }
  };

  return (
    <div className="ai-note ideas-note">
      <label htmlFor={id} className="ai-label">
        {askForContext ? ideaCopy.askForContext : 'What did you build today?'}
      </label>
      <textarea
        id={id}
        className="ai-textarea"
        data-testid="ideas-note"
        rows={2}
        maxLength={NOTE_MAX}
        value={text}
        placeholder="One sentence is enough."
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="ai-note-actions ideas-note-actions">
        {projects.length > 0 && (
          <select className="ideas-select" aria-label="Project for this note" value={target} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="">No project</option>
          </select>
        )}
        <FrostedButton className="ai-suggest" data-testid="ideas-note-add" disabled={text.trim() === '' || disabled} onClick={() => void submit()}>
          Add
        </FrostedButton>
      </div>
      {error && <p className="ai-field-error">{error}</p>}
    </div>
  );
}
