// What the project-ideas features say (T7, XBOT-5UVE6R). zod-free, so the
// renderer can import it as a value; main uses the same wording.
import type { IdeaKind, IdeaSourceKind } from './contracts/projects';

export const ideaCopy = {
  kinds: {
    problem_solved: 'Problem solved',
    feature_finished: 'Small feature finished',
    before_after: 'Before/after',
    bug_fix: 'Bug and fix',
    funny_failure: 'Funny failure',
    lesson: 'Useful lesson',
    demo: 'Demo',
    question: 'Question for builders',
  } satisfies Record<IdeaKind, string>,
  sources: {
    commit: 'Commit',
    doc: 'Doc',
    files: 'Files',
    note: 'Note',
    brief: 'Brief',
    fact: 'Confirmed fact',
  } satisfies Record<IdeaSourceKind, string>,
  claims: {
    notConfirmed: 'Not in your notes or confirmed facts',
    commitOnly: 'A commit doesn’t show that it shipped or works',
    linkUnknown: 'Not in your brief or notes',
  },
  preview: 'Ideas are off in preview.',
  pickPreview: 'Project folders are off in preview.',
  askForContext: 'Tell me one sentence about today',
  privacy:
    'xBot reads README files, docs, package manifests and Git commit messages from these folders only. It skips .env files, keys, dumps, dependencies, build output and anything your .gitignore lists, never runs code from them, and nothing leaves this Mac.',
} as const;
