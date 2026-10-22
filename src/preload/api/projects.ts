// Owned by T7 (XBOT-5UVE6R).
import type { ProjectsApi } from '../../shared/contracts/projects';
import { projectsChannels } from '../../shared/contracts/projects.channels';
import { invoke } from '../invoke';

export const projects: ProjectsApi = {
  list: () => invoke(projectsChannels.list),
  pick: () => invoke(projectsChannels.pick),
  remove: (id) => invoke(projectsChannels.remove, { id }),
  rescan: (id) => invoke(projectsChannels.rescan, { id }),
  saveBrief: (id, brief, options) => invoke(projectsChannels.saveBrief, { id, brief, options }),
  addNote: (projectId, text) => invoke(projectsChannels.addNote, { projectId, text }),
  ideas: () => invoke(projectsChannels.ideas),
  refreshIdeas: (mode) => invoke(projectsChannels.refreshIdeas, { mode }),
  cancelIdeas: () => invoke(projectsChannels.cancelIdeas),
  useIdea: (id) => invoke(projectsChannels.useIdea, { id }),
  dismissIdea: (id) => invoke(projectsChannels.dismissIdea, { id }),
};
