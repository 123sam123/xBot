import { existsSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIgnoreRules } from '../../src/main/services/projects/ignoreRules';
import { createSafeRoot, PathRefused, ScanBudget } from '../../src/main/services/projects/safeFs';
import { scanFolder } from '../../src/main/services/projects/scanner';
import { installLoopbackFetchSpy } from './helpers/loopbackFetch';
import { chatLines, makeService, ndjson, startMockOllama, type MockOllama, type TestService } from './helpers/mockOllama';
import {
  addAndScan,
  cleanupFixtures,
  commitAll,
  events,
  git,
  gitBinary,
  makeProjects,
  plainGit,
  recordingFs,
  recordingSpawn,
  subcommand,
  tempDir,
  writeScript,
  writeTree,
} from './helpers/projectFixtures';

// SPEC §19 project privacy and §22 "Ignore rules and secret redaction":
// what xBot reads from an approved folder, what it never reads, that no
// repository code runs while it reads Git, and that secrets never reach the
// prompt. Fixtures are built at test time; secrets are assembled here so
// nothing secret-shaped is committed.

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

const OUTSIDE_MARKER = 'OUTSIDE-ROOT-MARKER';

/** A project folder holding everything xBot must never read, plus a README and a doc it should. */
function buildPrivateTree(root: string, outside: string): void {
  writeTree(outside, { 'secret.md': `# Outside\n\n${OUTSIDE_MARKER} must never be read.\n` });
  writeTree(root, {
    'README.md': '# Fixture tool\n\nA tiny tool that renames screenshots by what is in them.\n',
    'docs/guide.md': '# Guide\n\nDrop a folder on it and the files get sensible names.\n',
    'docs/.gitignore': 'internal.md\n',
    'docs/internal.md': '# Internal\n\nnested-ignored plans\n',
    '.gitignore': 'private-notes.md\n',
    '.xbotignore': '!private-notes.md\n!.env\n',
    'private-notes.md': '# Private\n\ngitignored notes\n',
    '.env': 'API_TOKEN=fixture-value\n',
    id_rsa: 'not a real key\n',
    'secrets.pem': 'not a real pem\n',
    'dump.sql': 'INSERT INTO users VALUES (1);\n',
    'node_modules/x/README.md': '# dependency\n\nshould never be listed\n',
    'dist/README.md': '# build output\n\nshould never be listed\n',
    'src/index.js': 'console.log("hi");\n',
  });
  symlinkSync(join(outside, 'secret.md'), join(root, 'docs', 'escape.md'));
  symlinkSync('../.env', join(root, 'docs', 'inner.md'));
}

const NEVER_READ = ['.env', 'id_rsa', 'secrets.pem', 'dump.sql', 'private-notes.md', join('docs', 'internal.md'), join('docs', 'escape.md'), join('docs', 'inner.md')];

function expectNothingPrivateTouched(root: string, outside: string, calls: { op: string; path: string }[]): void {
  const opened = calls.filter((c) => c.op === 'open').map((c) => c.path);
  for (const rel of NEVER_READ) expect(opened, `opened ${rel}`).not.toContain(join(root, rel));
  expect(opened.some((p) => p.startsWith(outside + sep)), 'opened a file outside the folder').toBe(false);
  for (const dir of ['node_modules', 'dist']) {
    const inside = calls.filter((c) => (c.op === 'readdir' || c.op === 'open') && (c.path === join(root, dir) || c.path.startsWith(join(root, dir) + sep)));
    expect(inside, `listed or read inside ${dir}`).toEqual([]);
  }
  // It did read what it should: the README and the doc.
  expect(opened).toContain(join(root, 'README.md'));
  expect(opened).toContain(join(root, 'docs', 'guide.md'));
}

describe('fixture repo: denied and ignored files are never read', () => {
  it('in a Git repository', async () => {
    const root = tempDir();
    const outside = tempDir('xbot-outside-');
    buildPrivateTree(root, outside);
    git(root, ['init', '-q']);
    commitAll(root, 'Rename screenshots by their contents');
    t = makeService('http://127.0.0.1:9');
    const rec = recordingFs();
    const { projects } = makeProjects(t.service, t.db, { fs: rec.fs });

    const id = await addAndScan(projects, root);

    expect(projects.get(id)).toMatchObject({ isGit: true, scan: { state: 'ok' } });
    expectNothingPrivateTouched(root, outside, rec.calls);
    const all = events(t.db, id);
    expect(all.map((e) => e.kind)).toEqual(expect.arrayContaining(['commit', 'doc']));
    const text = JSON.stringify(all);
    expect(text).not.toContain(OUTSIDE_MARKER);
    // Committed secret files are never even named: the commit lists them as private files.
    for (const name of ['.env', 'id_rsa', 'secrets.pem', 'dump.sql', 'node_modules', 'dist/']) expect(text).not.toContain(name);
    expect(all.find((e) => e.kind === 'commit')?.summary).toMatch(/private files/);
  });

  it('in a folder without Git', async () => {
    const root = tempDir();
    const outside = tempDir('xbot-outside-');
    buildPrivateTree(root, outside);
    t = makeService('http://127.0.0.1:9');
    const rec = recordingFs();
    const { projects } = makeProjects(t.service, t.db, { fs: rec.fs });

    const id = await addAndScan(projects, root);

    expect(projects.get(id)).toMatchObject({ isGit: false, scan: { state: 'ok' } });
    expectNothingPrivateTouched(root, outside, rec.calls);
    const text = JSON.stringify(events(t.db, id));
    expect(text).not.toContain(OUTSIDE_MARKER);
    expect(text).toContain('src/index.js');
    for (const name of ['.env', 'id_rsa', 'secrets.pem', 'dump.sql', 'private-notes', 'internal.md', 'node_modules']) expect(text).not.toContain(name);
  });

  it('refuses ../ and absolute paths before touching the disk', async () => {
    const root = tempDir();
    writeTree(root, { 'README.md': '# x\n' });
    const rec = recordingFs();
    const safe = createSafeRoot({ root, fs: rec.fs, budget: new ScanBudget(), isExcluded: createIgnoreRules().isExcluded });
    for (const path of ['../x', 'docs/../../x', '..', '/etc/hosts', `${root}/README.md`, 'a\0b', '']) {
      await expect(safe.readText(path), path).rejects.toBeInstanceOf(PathRefused);
    }
    await expect(safe.list('../')).rejects.toBeInstanceOf(PathRefused);
    await expect(safe.meta('../README.md')).rejects.toBeInstanceOf(PathRefused);
    expect(rec.calls).toEqual([]);
  });

  it('reads no Git history through alternates pointing at another repository', async () => {
    const other = tempDir('xbot-other-');
    writeTree(other, { 'a.txt': 'a\n' });
    git(other, ['init', '-q']);
    commitAll(other, 'Subject from the other repository');
    const root = join(tempDir('xbot-parent-'), 'shared-clone');
    git(other, ['clone', '-q', '--shared', other, root]);
    expect(existsSync(join(root, '.git', 'objects', 'info', 'alternates'))).toBe(true);
    t = makeService('http://127.0.0.1:9');
    const spawned = recordingSpawn();
    const { projects } = makeProjects(t.service, t.db, { spawn: spawned.spawn });

    const id = await addAndScan(projects, root);

    expect(projects.get(id)).toMatchObject({ isGit: false, scan: { note: expect.stringMatching(/outside this folder/) } });
    expect(JSON.stringify(events(t.db, id))).not.toContain('Subject from the other repository');
    expect(spawned.calls).toEqual([]);
  });
});

describe('secret redaction', () => {
  it('a GitHub token, an AWS key, a JWT and a PEM block reach the prompt only as [redacted]', async () => {
    const githubToken = `ghp_${'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5'}`;
    const awsKey = `AKIA${'IOSFODNN7EXAMPLE'}`;
    const jwt = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkZpeHR1cmUifQ', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'].join('.');
    const pemLines = ['MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu', 'KUpRKfFLfRYC9AIKjbJTWit4CqvjWYzvQwECAwEAAQJAIJLixBy2qpFoS4DSmoEm'];
    const pem = [`-----BEGIN RSA ${'PRIVATE'} KEY-----`, ...pemLines, `-----END RSA ${'PRIVATE'} KEY-----`].join('\n');

    const root = tempDir();
    writeTree(root, {
      'README.md': `# alpha Fixture\n\nbravo ${githubToken} charlie ${awsKey} delta\n${pem}\necho done\n`,
      'src/app.js': 'export const x = 1;\n',
    });
    git(root, ['init', '-q']);
    commitAll(root, `Add login handshake foxtrot ${jwt}`);

    mock = await startMockOllama();
    mock.routes['POST /api/chat'] = (_req, res) => ndjson(res, chatLines('{"ideas": []}'));
    t = makeService(mock.endpoint);
    const { projects, ideas } = makeProjects(t.service, t.db);
    const id = await addAndScan(projects, root);
    // A full brief and 20 facts: activity must still reach the prompt.
    const long = (word: string) => `${word} `.repeat(120).slice(0, 480);
    projects.saveBrief(
      id,
      {
        name: 'Fixture',
        whatItDoes: long('renames'),
        whyBuilt: long('because'),
        intendedUsers: long('builders').slice(0, 190),
        stage: 'beta',
        publicUrl: 'https://example.com/fixture',
        sharingRestrictions: 'Never name the client.',
        confirmedFacts: Array.from({ length: 20 }, (_, i) => `Fact ${i + 1}: ${long('true').slice(0, 180)}`),
      },
      { readDocs: true, diffExcerpts: false },
    );

    await expect(ideas.refresh('auto', 'background')).resolves.toEqual({ status: 'done', added: 0 });

    const chats = mock.hits('/api/chat');
    expect(chats).toHaveLength(1);
    const content = (chats[0]!.body as { messages: { content: string }[] }).messages.map((m) => m.content).join('\n');
    for (const secret of [githubToken, awsKey, jwt, ...pemLines]) expect(content).not.toContain(secret);
    expect(content).not.toContain('PRIVATE KEY');
    for (const marker of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']) expect(content).toContain(marker);
    expect(content.split('[redacted]').length - 1).toBeGreaterThanOrEqual(4);
    // The secrets are not stored either.
    const stored = JSON.stringify(t.db.prepare('SELECT * FROM project_events').all()) + JSON.stringify(t.db.prepare('SELECT summary_text FROM projects').all());
    for (const secret of [githubToken, awsKey, jwt, ...pemLines]) expect(stored).not.toContain(secret);
  });
});

describe('no repository code runs while xBot reads Git', () => {
  it('fsmonitor, hooks, gpg, textconv, a submodule diff and a lazy-fetch remote never fire', async () => {
    const markers = tempDir('xbot-markers-');
    const scripts = tempDir('xbot-scripts-');
    const marker = (name: string) => join(markers, name);
    const touch = (name: string) => writeScript(join(scripts, `${name}.sh`), `touch ${marker(name)}`);

    // A submodule with its own textconv trap.
    const subSource = tempDir('xbot-sub-');
    writeTree(subSource, { 'notes.txt': 'one\n' });
    git(subSource, ['init', '-q']);
    commitAll(subSource, 'Submodule start');

    const root = tempDir();
    writeTree(root, { 'a.txt': 'first\n', 'c.txt': 'only in the first commit\n', '.gitattributes': '*.txt diff=trap\n' });
    git(root, ['init', '-q']);
    commitAll(root, 'Start the trap repo');
    const lost = git(root, ['rev-parse', 'HEAD:c.txt']).trim();
    unlinkSync(join(root, 'c.txt'));
    commitAll(root, 'Drop the scratch file');
    const dropped = git(root, ['rev-parse', 'HEAD']).trim();
    // Push the commits that need the blob deleted below out of xBot's 30-commit window.
    for (let i = 1; i <= 30; i += 1) git(root, ['commit', '-q', '--allow-empty', '-m', `Step ${i} of the plan`]);
    git(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subSource, 'sub']);
    commitAll(root, 'Add the submodule');
    writeTree(join(root, 'sub'), { 'notes.txt': 'one\ntwo\n', '.gitattributes': '*.txt diff=trap2\n' });
    commitAll(join(root, 'sub'), 'Submodule change');
    commitAll(root, 'Move the submodule forward');
    writeFileSync(join(root, 'a.txt'), 'first\nsecond\n');
    commitAll(root, 'Change the tracked text');
    // A commit carrying a (fake) signature, so showing a signature would call gpg.
    const tree = git(root, ['rev-parse', 'HEAD^{tree}']).trim();
    const parent = git(root, ['rev-parse', 'HEAD']).trim();
    const when = Math.floor(Date.now() / 1000);
    const object = `tree ${tree}\nparent ${parent}\nauthor Fixture <f@example.com> ${when} +0000\ncommitter Fixture <f@example.com> ${when} +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n Zm9v\n -----END PGP SIGNATURE-----\n\nSigned release notes\n`;
    const objectFile = join(scripts, 'commit.txt');
    writeFileSync(objectFile, object);
    const signed = git(root, ['hash-object', '-t', 'commit', '-w', objectFile]).trim();
    git(root, ['update-ref', 'HEAD', signed]);

    // Arm every trap, each touching its own marker.
    git(root, ['config', 'core.fsmonitor', touch('fsmonitor')]);
    writeScript(join(root, '.git', 'hooks', 'post-checkout'), `touch ${marker('post-checkout')}`);
    git(root, ['config', 'log.showSignature', 'true']);
    git(root, ['config', 'gpg.program', touch('gpg')]);
    git(root, ['config', 'diff.trap.textconv', writeScript(join(scripts, 'textconv.sh'), `touch ${marker('textconv')}\ncat "$1"`)]);
    git(root, ['config', 'diff.submodule', 'diff']);
    git(join(root, 'sub'), ['config', 'diff.trap2.textconv', writeScript(join(scripts, 'textconv2.sh'), `touch ${marker('submodule-textconv')}\ncat "$1"`)]);
    git(root, ['config', 'core.repositoryformatversion', '1']);
    git(root, ['config', 'extensions.partialClone', 'origin']);
    git(root, ['config', 'remote.origin.url', `ext::sh -c touch% ${marker('lazy-fetch')}`]);
    git(root, ['config', 'remote.origin.promisor', 'true']);
    git(root, ['config', 'protocol.ext.allow', 'always']);
    rmSync(join(root, '.git', 'objects', lost.slice(0, 2), lost.slice(2)));

    // Positive control: run the way a user's own git would, each trap fires.
    plainGit(root, ['status']);
    plainGit(root, ['log', '-n', '1']);
    plainGit(root, ['show', 'HEAD~1']);
    plainGit(root, ['show', 'HEAD~2']);
    plainGit(root, ['log', '--numstat']);
    plainGit(root, ['checkout', '-q', '-b', 'control']);
    expect(readdirSync(markers).sort()).toEqual(['fsmonitor', 'gpg', 'lazy-fetch', 'post-checkout', 'submodule-textconv', 'textconv']);
    for (const name of readdirSync(markers)) unlinkSync(marker(name));

    // xBot's scan, with diff excerpts on so `show` runs too.
    const spawned = recordingSpawn();
    const home = tempDir('xbot-home-');
    const outcome = await scanFolder(
      { rootPath: root, rootReal: root, options: { readDocs: true, diffExcerpts: true }, checkpoint: null, lastScanAt: null, summaryHash: null, docCache: {} },
      { now: Date.now, findGit: async () => gitBinary(), spawn: spawned.spawn, uid: typeof process.getuid === 'function' ? process.getuid() : null, home },
    );

    expect(readdirSync(markers)).toEqual([]);
    expect(outcome.isGit).toBe(true);
    const commits = outcome.events.filter((e) => e.kind === 'commit');
    expect(commits.length).toBeGreaterThan(0);
    // `show` really ran and produced an excerpt, without the textconv driver.
    expect(commits.find((e) => e.sourceRef === 'Change the tracked text')?.detail.excerpt).toEqual(expect.stringContaining('+second'));
    const commands = spawned.calls.map(subcommand);
    expect(commands).toContain('log');
    expect(commands).toContain('show');
    expect(commands).not.toContain('status');

    // Again from the commit that deleted the blob: `log --numstat` now needs it, so a lazy
    // fetch would run the remote's command. xBot's read fails, retries without the stats,
    // and still finds the commits.
    git(root, ['update-ref', 'HEAD', dropped]);
    const again = await scanFolder(
      { rootPath: root, rootReal: root, options: { readDocs: true, diffExcerpts: true }, checkpoint: null, lastScanAt: null, summaryHash: null, docCache: {} },
      { now: Date.now, findGit: async () => gitBinary(), spawn: spawned.spawn, uid: typeof process.getuid === 'function' ? process.getuid() : null, home },
    );
    expect(readdirSync(markers)).toEqual([]);
    expect(again.events.filter((e) => e.kind === 'commit').map((e) => e.sourceRef)).toEqual(['Drop the scratch file', 'Start the trap repo']);
  });
});
