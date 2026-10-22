import { useId, useState } from 'react';
import { ideaCopy } from '../../../shared/ideaCopy';
import type { PickResult, ProjectBrief, ProjectOptions, ProjectSummary } from '../../../shared/contracts/projects';
import { FrostedButton, GhostButton, Sheet, StatusChip, Toggle } from '../../design-system';
import { relativeTime } from './useIdeas';

// The approved folders: add (native picker, in main), rescan, remove, and
// each folder's editable brief. The brief is the user's own word about the
// project, so the ideas treat it (and its confirmed facts) as true.

const URL_OK = /^https?:\/\/\S+$/i;

export function ProjectsSheet({ open, onClose, projects, preview }: { open: boolean; onClose(): void; projects: readonly ProjectSummary[]; preview: boolean }) {
  return (
    <Sheet open={open} title="Projects" onClose={onClose} testId="projects-sheet">
      <ProjectsBody projects={projects} preview={preview} />
    </Sheet>
  );
}

/** What the native picker added, refused or noted, as one line each. */
export function pickMessages(result: PickResult): { tone: 'neutral' | 'warning'; text: string }[] {
  return [
    ...(result.added.length > 0 ? [{ tone: 'neutral' as const, text: `Added ${result.added.join(', ')}. Reading it now…` }] : []),
    ...result.rejected.map((r) => ({ tone: 'warning' as const, text: `${r.name}: ${r.reason}` })),
    ...result.notes.map((text) => ({ tone: 'neutral' as const, text })),
  ];
}

/** Opens the native folder picker; resolves to the lines to show. */
export async function pickFolders(): Promise<{ tone: 'neutral' | 'warning'; text: string }[]> {
  const result = await window.xbot.projects.pick();
  return result.ok ? pickMessages(result.data) : [{ tone: 'warning', text: result.error.message }];
}

function ProjectsBody({ projects, preview }: { projects: readonly ProjectSummary[]; preview: boolean }) {
  const [messages, setMessages] = useState<{ tone: 'neutral' | 'warning'; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      setMessages(await pickFolders());
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="sheet-note">{ideaCopy.privacy}</p>
      <div className="projects-add">
        <FrostedButton className="ai-suggest" data-testid="projects-add" disabled={preview || busy} onClick={() => void add()}>
          Add folder…
        </FrostedButton>
        {preview && <span className="sheet-note">{ideaCopy.pickPreview}</span>}
      </div>
      {messages.map((m, index) => (
        <StatusChip key={index} tone={m.tone === 'warning' ? 'warning' : undefined} className="projects-message">
          {m.text}
        </StatusChip>
      ))}
      {projects.length === 0 && !preview && <p className="ideas-empty">No folders yet. Ideas can still come from what you tell xBot.</p>}
      <div className="ai-cards">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </>
  );
}

function statusLine(project: ProjectSummary): { text: string; tone: 'neutral' | 'warning' } {
  const { scan } = project;
  if (scan.scanning) return { text: 'Reading…', tone: 'neutral' };
  switch (scan.state) {
    case 'never':
      return { text: 'Not read yet', tone: 'neutral' };
    case 'missing':
      return { text: 'Folder missing', tone: 'warning' };
    case 'denied':
      return { text: 'xBot isn’t allowed to read this folder. Allow it in System Settings → Privacy & Security, then Rescan.', tone: 'warning' };
    case 'error':
      return { text: scan.note ?? 'This folder couldn’t be read', tone: 'warning' };
    case 'partial':
      return { text: `Partial scan${scan.at ? ` · ${relativeTime(scan.at)}` : ''}`, tone: 'warning' };
    case 'ok':
      return { text: `Read ${scan.at ? relativeTime(scan.at) : ''}`.trim(), tone: 'neutral' };
  }
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const status = statusLine(project);
  const note = project.scan.state === 'ok' || project.scan.state === 'partial' ? project.scan.note : null;
  return (
    <article className="ai-card project-card" data-testid="project-card">
      <div className="project-head">
        <h3 className="project-name">{project.name}</h3>
        {project.isGit && <span className="badge">Git</span>}
      </div>
      <p className="project-path">{project.displayPath}</p>
      <p className={status.tone === 'warning' ? 'project-status project-status-warning' : 'project-status'}>{status.text}</p>
      {note && <p className="project-note">{note}</p>}
      {confirmRemove ? (
        <div className="ai-card-actions project-actions">
          <span className="project-confirm">Remove from xBot? The folder itself stays as it is.</span>
          <GhostButton className="ai-status-action" onClick={() => setConfirmRemove(false)}>
            Keep
          </GhostButton>
          <FrostedButton className="ai-use" data-testid="project-remove-confirm" onClick={() => void window.xbot.projects.remove(project.id)}>
            Remove
          </FrostedButton>
        </div>
      ) : (
        <div className="ai-card-actions project-actions">
          <GhostButton className="ai-status-action" onClick={() => setConfirmRemove(true)}>
            Remove
          </GhostButton>
          <GhostButton className="ai-status-action" disabled={project.scan.scanning} onClick={() => void window.xbot.projects.rescan(project.id)}>
            Rescan
          </GhostButton>
          <GhostButton className="ai-status-action" data-testid="project-edit" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            {editing ? 'Close brief' : 'Edit brief'}
          </GhostButton>
        </div>
      )}
      {editing && <BriefEditor key={project.id} project={project} onDone={() => setEditing(false)} />}
    </article>
  );
}

function Field({ label, value, onChange, max, multiline = false, placeholder }: { label: string; value: string; onChange(v: string): void; max: number; multiline?: boolean; placeholder?: string }) {
  const id = useId();
  return (
    <div className="ai-field">
      <label htmlFor={id} className="ai-label">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} className="ai-textarea" rows={2} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="ai-input" type="text" spellCheck={false} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function BriefEditor({ project, onDone }: { project: ProjectSummary; onDone(): void }) {
  const [brief, setBrief] = useState<ProjectBrief>(project.brief);
  const [facts, setFacts] = useState(project.brief.confirmedFacts.join('\n'));
  const [options, setOptions] = useState<ProjectOptions>(project.options);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof Omit<ProjectBrief, 'confirmedFacts'>) => (value: string) => setBrief((b) => ({ ...b, [key]: value }));

  const save = async () => {
    const confirmedFacts = facts
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    if (brief.name.trim() === '') return setError('Give the project a name.');
    if (brief.publicUrl.trim() !== '' && !URL_OK.test(brief.publicUrl.trim())) return setError('The public URL should start with https://');
    if (confirmedFacts.length > 20) return setError('Keep it to 20 confirmed facts.');
    if (confirmedFacts.some((f) => f.length > 200)) return setError('Keep each confirmed fact under 200 characters.');
    const result = await window.xbot.projects.saveBrief(project.id, { ...brief, publicUrl: brief.publicUrl.trim(), confirmedFacts }, options);
    if (!result.ok) return setError(result.error.message);
    setError(null);
    onDone();
  };

  return (
    <div className="brief-editor" data-testid="brief-editor">
      <Field label="Name" value={brief.name} onChange={set('name')} max={80} />
      <Field label="What it does" value={brief.whatItDoes} onChange={set('whatItDoes')} max={500} multiline />
      <Field label="Why we built it" value={brief.whyBuilt} onChange={set('whyBuilt')} max={500} multiline />
      <Field label="Intended users" value={brief.intendedUsers} onChange={set('intendedUsers')} max={200} />
      <Field label="Current stage" value={brief.stage} onChange={set('stage')} max={80} placeholder="Idea, prototype, beta, launched…" />
      <Field label="Public URL" value={brief.publicUrl} onChange={set('publicUrl')} max={300} placeholder="https://" />
      <Field
        label="Sharing restrictions"
        value={brief.sharingRestrictions}
        onChange={set('sharingRestrictions')}
        max={500}
        multiline
        placeholder="What must never be posted, e.g. the client’s name."
      />
      <Field label="Confirmed facts, one per line" value={facts} onChange={setFacts} max={4200} multiline placeholder="Things that are true and fine to say." />
      <Toggle label="Read docs" description="The changelog and docs/ as well as the README." checked={options.readDocs} onChange={(readDocs) => setOptions((o) => ({ ...o, readDocs }))} />
      <Toggle
        label="Include diff excerpts"
        description="Short, redacted excerpts of the newest commits. Off by default."
        checked={options.diffExcerpts}
        onChange={(diffExcerpts) => setOptions((o) => ({ ...o, diffExcerpts }))}
      />
      {error && <p className="ai-field-error">{error}</p>}
      <div className="ai-card-actions">
        <GhostButton className="ai-status-action" onClick={onDone}>
          Cancel
        </GhostButton>
        <FrostedButton className="ai-use" data-testid="brief-save" onClick={() => void save()}>
          Save
        </FrostedButton>
      </div>
    </div>
  );
}
