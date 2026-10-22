import { join, sep } from 'node:path';

// Which picked folders xBot refuses to treat as a project. Applied to the
// native picker's results in ipc/projects.ts only, so tests can add fixture
// folders under the temp dir (`/private/var/…` on macOS) through the service.

const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);
const ancestorOf = (path: string, dir: string) => dir.startsWith(path.endsWith(sep) ? path : path + sep);

const SYSTEM_DIRS = ['/System', '/Library', '/private', '/usr', '/bin', '/sbin', '/etc', '/Applications', '/dev', '/proc', '/sys'];
const PRIVATE_HOME_DIRS = ['Library', '.ssh', '.aws', '.gnupg', '.config', '.kube', '.docker'];

/** Why `real` (a folder's realpath) can't be a project, or null when it can. */
export function folderRefusal(real: string, { home, userData }: { home: string; userData: string }): string | null {
  if (real === '/' || real === '') return 'Choose a project folder, not the whole disk.';
  if (real === '/Volumes' || /^\/Volumes\/[^/]+$/.test(real)) return 'Choose a project folder, not a whole disk.';
  if (real === home || ancestorOf(real, home)) return 'That would include your whole home folder. Choose a project folder inside it.';
  if (PRIVATE_HOME_DIRS.some((dir) => inside(real, join(home, dir)))) return 'That’s a private settings folder, not a project.';
  if (SYSTEM_DIRS.some((dir) => inside(real, dir))) return 'That’s a system folder, not a project.';
  if (inside(real, userData) || ancestorOf(real, userData)) return 'That folder holds xBot’s own data.';
  return null;
}
