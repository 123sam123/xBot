import { useEffect, useState } from 'react';
import type { IdeasState, ProjectSummary } from '../../../shared/contracts/projects';

// The ideas list and the project folders from main, kept current through
// the forwarded `projects:ideas-changed` and `projects:changed` events. The
// last value any instance saw seeds the next one (an onboarding step, the
// sheet), so nothing flashes empty.

let lastIdeas: IdeasState | null = null;
let lastProjects: ProjectSummary[] | null = null;

export function useIdeas(enabled = true): IdeasState | null {
  const [state, setState] = useState<IdeasState | null>(() => (enabled ? lastIdeas : null));
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const set = (next: IdeasState) => {
      lastIdeas = next;
      if (alive) setState(next);
    };
    void window.xbot.projects.ideas().then((result) => {
      if (result.ok) set(result.data);
    });
    const off = window.xbot.events.on('projects:ideas-changed', set);
    return () => {
      alive = false;
      off();
    };
  }, [enabled]);
  return state;
}

export function useProjects(enabled = true): ProjectSummary[] | null {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(() => (enabled ? lastProjects : null));
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const set = (next: ProjectSummary[]) => {
      lastProjects = next;
      if (alive) setProjects(next);
    };
    void window.xbot.projects.list().then((result) => {
      if (result.ok) set(result.data);
    });
    const off = window.xbot.events.on('projects:changed', ({ projects: next }) => set(next));
    return () => {
      alive = false;
      off();
    };
  }, [enabled]);
  return projects;
}

/** "3 min ago", "2 h ago", "yesterday", or the date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'yesterday';
  return new Date(iso).toLocaleDateString();
}
