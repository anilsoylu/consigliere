import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runChecks, summarize } from '../doctor.mjs';
import { HOOK_FILES, DEFAULT_RULES, HOOK_ENTRIES, MERGE_READINESS_SKILL, MERGE_READINESS_FILES, YAGNI_SKILL, YAGNI_FILES, hookCommand } from '../manifest.mjs';

const DOCTOR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'doctor.mjs');
const temps = [];

function temp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function writeFile(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// hooks and rules carry their filename as content so a byte mismatch is easy to stage
function makeRepoFixture() {
  const repo = temp('consigliere-repo-');
  for (const hook of HOOK_FILES) writeFile(path.join(repo, 'hooks', hook), hook);
  for (const rule of DEFAULT_RULES) writeFile(path.join(repo, 'rules', rule), rule);
  for (const file of YAGNI_FILES) writeFile(path.join(repo, 'skills', YAGNI_SKILL, file), file);
  writeFile(path.join(repo, 'install.mjs'));
  writeFile(path.join(repo, 'uninstall.mjs'));
  return repo;
}

// mirrors what install.mjs writes: one block per matcher, absolute hook commands
function settingsFor(home) {
  const hooksDir = path.join(home, '.claude', 'hooks');
  const hooks = {};
  for (const [event, matcher, script] of HOOK_ENTRIES) {
    hooks[event] ??= [];
    const block = hooks[event].find((b) => (matcher ? b.matcher === matcher : !b.matcher))
      || (hooks[event].push(matcher ? { matcher, hooks: [] } : { hooks: [] }), hooks[event].at(-1));
    block.hooks.push({ type: 'command', command: hookCommand(hooksDir, script) });
  }
  return JSON.stringify({ hooks });
}

function installDefaultFiles(home) {
  const claude = path.join(home, '.claude');
  for (const hook of HOOK_FILES) writeFile(path.join(claude, 'hooks', hook), hook);
  fs.chmodSync(path.join(claude, 'hooks', 'advisor-watchdog.sh'), 0o755);
  for (const rule of DEFAULT_RULES) writeFile(path.join(claude, 'rules', rule), rule);
  for (const file of YAGNI_FILES) writeFile(path.join(claude, 'skills', YAGNI_SKILL, file), file);
  writeFile(path.join(claude, 'settings.json'), settingsFor(home));
  writeFile(path.join(claude, 'plugins', 'cache', 'openai-codex', 'codex', '1.0.0', 'scripts', 'codex-companion.mjs'));
  writeFile(path.join(home, '.codex', 'config.toml'), 'web_search = "disabled"\n');
}

function check(checks, name) {
  return checks.find((c) => c.name === name);
}

function run(home, repo) {
  return runChecks({ home, repo, platform: 'darwin' });
}

test('passes for a complete default install', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);

  const summary = summarize(run(home, makeRepoFixture()));

  assert.equal(summary.fail, 0);
  assert.equal(summary.warn, 0);
  assert.ok(summary.pass >= 7);
});

test('warns when an installed hook no longer matches the repo copy', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  writeFile(path.join(home, '.claude', 'hooks', 'advisor-gate.mjs'), 'edited by hand');

  const hooks = check(run(home, makeRepoFixture()), 'installed hooks');

  assert.equal(hooks.level, 'warn');
  assert.match(hooks.detail, /advisor-gate\.mjs/);
});

test('warns about a locally customized rule instead of certifying it', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  writeFile(path.join(home, '.claude', 'rules', 'coding-discipline.md'), 'my own version');

  const rules = check(run(home, makeRepoFixture()), 'installed rules');

  assert.equal(rules.level, 'warn');
  assert.match(rules.detail, /customized locally.*coding-discipline\.md/);
});

test('warns when a hook entry does not carry the command the installer writes', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  settings.hooks.PreToolUse[0].hooks[0].command = 'echo advisor-mark.mjs';
  writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify(settings));

  const entries = check(run(home, makeRepoFixture()), 'settings hooks');

  assert.equal(entries.level, 'warn');
  assert.match(entries.detail, /PreToolUse\/Bash:advisor-mark\.mjs/);
});

test('warns when the installer command is registered twice for one entry', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const block = settings.hooks.PreToolUse[0];
  block.hooks.push({ ...block.hooks[0], command: 'echo advisor-mark.mjs' });
  writeFile(settingsPath, JSON.stringify(settings));

  const entries = check(run(home, makeRepoFixture()), 'settings hooks');

  assert.equal(entries.level, 'warn');
  assert.match(entries.detail, /exactly once.*PreToolUse\/Bash:advisor-mark\.mjs/);
});

test('reports missing and wrongly registered entries together', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.hooks.PreToolUse[0].hooks[0].command = 'echo advisor-mark.mjs';
  settings.hooks.UserPromptSubmit = [];
  writeFile(settingsPath, JSON.stringify(settings));

  const entries = check(run(home, makeRepoFixture()), 'settings hooks');

  assert.equal(entries.level, 'warn');
  assert.match(entries.detail, /missing: UserPromptSubmit:advisor-inject\.mjs/);
  assert.match(entries.detail, /exactly once.*PreToolUse\/Bash:advisor-mark\.mjs/);
});

test('reports invalid settings JSON as a failure without echoing its contents', () => {
  const home = temp('consigliere-doctor-');
  writeFile(path.join(home, '.claude', 'settings.json'), 'sk-ant-SECRET123 not json');

  const settings = check(run(home, makeRepoFixture()), 'settings.json');

  assert.equal(settings.level, 'fail');
  assert.doesNotMatch(settings.detail, /SECRET/);
});

for (const [label, content, expected] of [
  ['an event that is not an array', { hooks: { PreToolUse: {} } }, /hooks\.PreToolUse must be an array/],
  ['a null block', { hooks: { PreToolUse: [null] } }, /hooks\.PreToolUse\[0\] must be an object/],
  ['a block whose hooks is an object', { hooks: { PreToolUse: [{ hooks: {} }] } }, /hooks\.PreToolUse\[0\]\.hooks must be an array/],
  ['a block with no hooks at all', { hooks: { PreToolUse: [{ matcher: 'Other' }] } }, /hooks\.PreToolUse\[0\]\.hooks must be an array/],
  ['a root that is not an object', ['nope'], /must hold a JSON object/],
]) {
  test(`fails instead of crashing on ${label}`, () => {
    const home = temp('consigliere-doctor-');
    writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify(content));

    const settings = check(run(home, makeRepoFixture()), 'settings.json');

    assert.equal(settings.level, 'fail');
    assert.match(settings.detail, expected);
  });
}

test('warns when installed hook entries are missing', () => {
  const home = temp('consigliere-doctor-');
  writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));

  assert.equal(check(run(home, makeRepoFixture()), 'settings hooks').level, 'warn');
});

for (const [label, toml] of [
  ['carries a trailing comment', 'web_search = "disabled" # consigliere\n'],
  ['follows a multiline string', "notes = '''\nanything\n'''\nweb_search = \"disabled\"\n"],
]) {
  test(`accepts a disabled web_search that ${label}`, () => {
    const home = temp('consigliere-doctor-');
    installDefaultFiles(home);
    writeFile(path.join(home, '.codex', 'config.toml'), toml);

    assert.equal(check(run(home, makeRepoFixture()), 'codex web search').level, 'pass');
  });
}

for (const [label, toml] of [
  ['set to something other than disabled', 'web_search = "live"\n'],
  ['disabled only inside another table', '[profiles.fast]\nweb_search = "disabled"\n'],
  ['assigned twice at the top level', 'web_search = "disabled"\nweb_search = "live"\n'],
  ['only mentioned inside a multiline string', "notes = '''\nweb_search = \"disabled\"\n'''\n"],
  ['only mentioned past an escaped delimiter', 'notes = """\nstill inside: \\"""\nweb_search = "disabled"\n"""\n'],
]) {
  test(`warns when web_search is ${label}`, () => {
    const home = temp('consigliere-doctor-');
    installDefaultFiles(home);
    writeFile(path.join(home, '.codex', 'config.toml'), toml);

    assert.equal(check(run(home, makeRepoFixture()), 'codex web search').level, 'warn');
  });
}

// the skill is optional, so the check only exists once the directory is there
function installMergeReadiness(home, repo) {
  for (const file of MERGE_READINESS_FILES) {
    writeFile(path.join(repo, 'skills', MERGE_READINESS_SKILL, file), file);
    writeFile(path.join(home, '.claude', 'skills', MERGE_READINESS_SKILL, file), file);
  }
}

test('stays silent about merge-readiness when it was never installed', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);

  assert.equal(check(run(home, makeRepoFixture()), 'merge-readiness skill'), undefined);
});

test('passes when the merge-readiness skill and its script both match the repo', () => {
  const home = temp('consigliere-doctor-');
  const repo = makeRepoFixture();
  installDefaultFiles(home);
  installMergeReadiness(home, repo);

  const skill = check(run(home, repo), 'merge-readiness skill');

  assert.equal(skill.level, 'pass');
});

test('warns when the skill is installed without the workflow script it invokes', () => {
  const home = temp('consigliere-doctor-');
  const repo = makeRepoFixture();
  installDefaultFiles(home);
  installMergeReadiness(home, repo);
  fs.rmSync(path.join(home, '.claude', 'skills', MERGE_READINESS_SKILL, 'merge-readiness.js'));

  const skill = check(run(home, repo), 'merge-readiness skill');

  assert.equal(skill.level, 'warn');
  assert.match(skill.detail, /missing: merge-readiness\.js/);
});

test('warns about a locally customized merge-readiness file instead of certifying it', () => {
  const home = temp('consigliere-doctor-');
  const repo = makeRepoFixture();
  installDefaultFiles(home);
  installMergeReadiness(home, repo);
  writeFile(path.join(home, '.claude', 'skills', MERGE_READINESS_SKILL, 'SKILL.md'), 'my own version');

  const skill = check(run(home, repo), 'merge-readiness skill');

  assert.equal(skill.level, 'warn');
  assert.match(skill.detail, /customized locally.*SKILL\.md/);
});

// yagni ships by default, so unlike merge-readiness its absence is a finding, not silence
test('warns when the yagni skill was never installed', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  fs.rmSync(path.join(home, '.claude', 'skills', YAGNI_SKILL), { recursive: true });

  const skill = check(run(home, makeRepoFixture()), 'yagni skill');

  assert.equal(skill.level, 'warn');
  assert.match(skill.detail, /not installed \(SKILL\.md\)/);
  // doctor cannot tell a deliberate removal from a broken install, so it must not insist
  assert.match(skill.detail, /ignore this if you removed it on purpose/);
});

test('warns about a locally customized yagni skill instead of certifying it', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  writeFile(path.join(home, '.claude', 'skills', YAGNI_SKILL, 'SKILL.md'), 'my own version');

  const skill = check(run(home, makeRepoFixture()), 'yagni skill');

  assert.equal(skill.level, 'warn');
  assert.match(skill.detail, /customized locally.*SKILL\.md/);
});

test('--json prints a summary and --help exits clean', () => {
  const output = JSON.parse(execFileSync(process.execPath, [DOCTOR, '--json'], { encoding: 'utf8' }));

  assert.ok(Array.isArray(output.checks));
  assert.equal(typeof output.summary.pass, 'number');
  assert.match(execFileSync(process.execPath, [DOCTOR, '--help'], { encoding: 'utf8' }), /Usage: node doctor\.mjs/);
});

test('rejects an unknown flag with exit code 2', () => {
  assert.throws(
    () => execFileSync(process.execPath, [DOCTOR, '--wat'], { encoding: 'utf8', stdio: 'pipe' }),
    (error) => error.status === 2 && /unknown flag: --wat/.test(error.stderr)
  );
});
