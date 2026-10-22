import { afterEach, describe, expect, it } from 'vitest';
import { installLoopbackFetchSpy } from './helpers/loopbackFetch';
import { chatLines, makeService, ndjson, startMockOllama, type MockOllama, type TestService } from './helpers/mockOllama';
import { addAndScan, cleanupFixtures, commitAll, events, git, makeProjects, recordingSpawn, tempDir, writeTree } from './helpers/projectFixtures';

// SPEC §11/§12: scans keep checkpoints and deduplicate events, an unchanged
// history costs no AI call, dismissed stories never come back, a folder
// without Git still yields activity, and with nothing to go on xBot asks for
// one sentence instead of generating filler. Against a mock Ollama on
// 127.0.0.1 (T6's helper) and fixture folders built at test time.

installLoopbackFetchSpy({ expectRequests: true });

let mock: MockOllama | null = null;
let t: TestService | null = null;
afterEach(async () => {
  t?.close();
  t = null;
  await mock?.close();
  mock = null;
  cleanupFixtures();
});

type IdeaSpec = { kind: string; text: string; cites: string };

/** The id (`E2`, …) of the prompt's DATA block whose text contains `phrase`. */
function blockFor(body: unknown, phrase: string): string {
  const user = (body as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === 'user')?.content ?? '';
  for (const match of user.matchAll(/<<<DATA name="([A-Z]+\d*)">>>\n([^\n]*)/g)) if (match[2]!.includes(phrase)) return match[1]!;
  return 'E99';
}

/** The mock answers every chat with these ideas, each citing the block that contains its `cites` phrase. */
function answerWith(m: MockOllama, ideas: IdeaSpec[]): void {
  m.routes['POST /api/chat'] = (_req, res, body) =>
    ndjson(res, chatLines(JSON.stringify({ ideas: ideas.map((i) => ({ kind: i.kind, text: i.text, sources: [blockFor(body, i.cites)], claims: [] })) })));
}

async function mockIdeas(ideas: IdeaSpec[]): Promise<MockOllama> {
  const m = await startMockOllama();
  answerWith(m, ideas);
  return m;
}

function repoWithHistory(): string {
  const root = tempDir();
  writeTree(root, { 'README.md': '# Renamer\n\nRenames screenshots by what is in them.\n', 'src/rename.js': 'export const rename = () => {};\n' });
  git(root, ['init', '-q']);
  commitAll(root, 'Add the screenshot renamer');
  writeTree(root, { 'src/rename.js': 'export const rename = (file) => file;\n' });
  commitAll(root, 'Stop the renamer from eating file extensions');
  return root;
}

const STORY = 'Fixed the renamer that kept eating my screenshot file extensions.';

describe('dedupe and dismissal', () => {
  it('an unchanged history adds no events and makes no AI call; a dismissed story never comes back', async () => {
    mock = await mockIdeas([{ kind: 'bug_fix', text: STORY, cites: 'Stop the renamer' }]);
    t = makeService(mock.endpoint);
    const { projects, ideas } = makeProjects(t.service, t.db);
    const root = repoWithHistory();
    const id = await addAndScan(projects, root);
    const firstEvents = events(t.db).length;
    expect(firstEvents).toBeGreaterThanOrEqual(3); // two commits and the README

    await expect(ideas.refresh('auto', 'background')).resolves.toEqual({ status: 'done', added: 1 });
    expect(mock.hits('/api/chat')).toHaveLength(1);
    const [idea] = ideas.state().ideas;
    expect(idea).toMatchObject({ kind: 'bug_fix', text: STORY, projectId: id });
    // "Fixed" from commits alone is an inferred claim, marked for confirmation.
    expect(idea!.claims).toEqual([expect.objectContaining({ confirmed: false })]);
    expect(idea!.sources[0]).toMatchObject({ kind: 'commit', label: 'Stop the renamer from eating file extensions' });

    // Rescan of unchanged history: no new events, and no generation.
    await projects.rescan(id);
    expect(events(t.db)).toHaveLength(firstEvents);
    await expect(ideas.refresh('auto', 'background')).resolves.toEqual({ status: 'up_to_date' });
    expect(mock.hits('/api/chat')).toHaveLength(1);

    // Dismiss it, remove the folder, add it again and force a regeneration that returns the
    // same story, a near-identical one resting on a different commit, and a reworded one.
    ideas.dismiss(idea!.id);
    projects.remove(id);
    await addAndScan(projects, root);
    answerWith(mock, [
      { kind: 'bug_fix', text: STORY, cites: 'Stop the renamer' },
      { kind: 'lesson', text: `${STORY} Again.`, cites: 'Add the screenshot renamer' },
      // Reworded, another kind, the same commit: only the dismissal key can catch it.
      { kind: 'demo', text: 'Watch the renamer keep .png on every screenshot now.', cites: 'Stop the renamer' },
    ]);
    await expect(ideas.refresh('force', 'interactive')).resolves.toEqual({ status: 'done', added: 0 });
    expect(mock.hits('/api/chat')).toHaveLength(2);
    expect(ideas.state().ideas).toEqual([]);
    expect(ideas.getTopRelevant()).toBeNull();
  });
});

describe('a folder without Git', () => {
  it('a README plus notes produce events, and git never runs', async () => {
    t = makeService('http://127.0.0.1:9');
    const spawned = recordingSpawn();
    const { projects } = makeProjects(t.service, t.db, { spawn: spawned.spawn });
    const root = tempDir();
    writeTree(root, { 'README.md': '# Sketchbook\n\nLoose experiments with a pen plotter.\n' });

    const id = await addAndScan(projects, root);
    projects.addNote(id, 'Got the plotter to draw a spiral without lifting the pen.');
    projects.addNote(id, 'Tried a hatch fill; it tore the paper.');

    expect(projects.get(id)).toMatchObject({ isGit: false, scan: { state: 'ok' } });
    const kinds = events(t.db, id).map((e) => e.kind);
    expect(kinds).toContain('doc');
    expect(kinds.filter((k) => k === 'note')).toHaveLength(2);
    expect(events(t.db, id).find((e) => e.kind === 'doc')?.summary).toContain('Loose experiments with a pen plotter');
    expect(spawned.calls).toEqual([]);
  });
});

describe('no useful activity', () => {
  it('with no folders and no notes, asks for one sentence and makes no AI call', async () => {
    mock = await mockIdeas([]);
    t = makeService(mock.endpoint);
    const { ideas } = makeProjects(t.service, t.db);

    await expect(ideas.refresh('auto', 'background')).resolves.toEqual({ status: 'needs_context' });
    await expect(ideas.refresh('force', 'interactive')).resolves.toEqual({ status: 'needs_context' });
    expect(ideas.state()).toMatchObject({ needsContext: true, ideas: [] });
    // Not even a probe: nothing reached Ollama.
    expect(mock.requests).toHaveLength(0);
  });

  it('a repository with only merges, bumps and typo fixes asks for one sentence too', async () => {
    mock = await mockIdeas([]);
    t = makeService(mock.endpoint);
    const { projects, ideas } = makeProjects(t.service, t.db);
    const root = tempDir();
    writeTree(root, { 'index.js': 'console.log(1);\n' });
    git(root, ['init', '-q']);
    commitAll(root, 'wip');
    writeTree(root, { 'index.js': 'console.log(2);\n' });
    commitAll(root, 'bump deps');
    writeTree(root, { 'index.js': 'console.log(3);\n' });
    commitAll(root, 'fix typo');
    const id = await addAndScan(projects, root);
    expect(events(t.db, id).length).toBe(3);
    expect(events(t.db, id).every((e) => e.low_signal === 1)).toBe(true);
    expect(projects.hasNewActivitySince(0)).toBe(false);

    await expect(ideas.refresh('auto', 'background')).resolves.toEqual({ status: 'needs_context' });
    expect(mock.hits('/api/chat')).toHaveLength(0);
  });
});
