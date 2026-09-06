import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runChecks, summarize, compareTags } from '../doctor.mjs';
import { VERSION, STATE_FILE, HOOK_FILES, AGENT_FILES, DEFAULT_RULES, WORKFLOW_RULE, HANDOFF_SKILLS, GRILLING_SKILLS, GRILLING_FILES, OPTIMIZE_SKILLS, HOOK_ENTRIES, MERGE_READINESS_SKILL, MERGE_READINESS_FILES, UPGRADE_SKILL, UPGRADE_FILES, YAGNI_SKILL, YAGNI_FILES, IMPLEMENT_SKILL, IMPLEMENT_FILES, WIZARD_SKILL, WIZARD_FILES, DEBUGGING_SKILL, DEBUGGING_FILES, SHADCN_SKILL, SHADCN_FILES, RELEASE_PERMISSIONS, RECOMMENDED_ENV, RECOMMENDED_SETTINGS, hookCommand } from '../manifest.mjs';

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
  for (const agent of AGENT_FILES) writeFile(path.join(repo, 'agents', agent), agent);
  for (const rule of DEFAULT_RULES) writeFile(path.join(repo, 'rules', rule), rule);
  for (const file of UPGRADE_FILES) writeFile(path.join(repo, 'skills', UPGRADE_SKILL, file), file);
  for (const file of YAGNI_FILES) writeFile(path.join(repo, 'skills', YAGNI_SKILL, file), file);
  for (const file of IMPLEMENT_FILES) writeFile(path.join(repo, 'skills', IMPLEMENT_SKILL, file), file);
  for (const skill of GRILLING_SKILLS) for (const file of GRILLING_FILES) writeFile(path.join(repo, 'skills', skill, file), file);
  for (const file of WIZARD_FILES) writeFile(path.join(repo, 'skills', WIZARD_SKILL, file), file);
  for (const file of DEBUGGING_FILES) writeFile(path.join(repo, 'skills', DEBUGGING_SKILL, file), file);
  for (const file of SHADCN_FILES) writeFile(path.join(repo, 'skills', SHADCN_SKILL, file), file);
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
  return JSON.stringify({
    hooks,
    env: { ...RECOMMENDED_ENV },
    ...RECOMMENDED_SETTINGS,
  });
}

function installDefaultFiles(home) {
  const claude = path.join(home, '.claude');
  for (const hook of HOOK_FILES) writeFile(path.join(claude, 'hooks', hook), hook);
  for (const agent of AGENT_FILES) writeFile(path.join(claude, 'agents', agent), agent);
  for (const rule of DEFAULT_RULES) writeFile(path.join(claude, 'rules', rule), rule);
  for (const file of UPGRADE_FILES) writeFile(path.join(claude, 'skills', UPGRADE_SKILL, file), file);
  for (const file of YAGNI_FILES) writeFile(path.join(claude, 'skills', YAGNI_SKILL, file), file);
  for (const file of IMPLEMENT_FILES) writeFile(path.join(claude, 'skills', IMPLEMENT_SKILL, file), file);
  for (const skill of GRILLING_SKILLS) for (const file of GRILLING_FILES) writeFile(path.join(claude, 'skills', skill, file), file);
  for (const file of WIZARD_FILES) writeFile(path.join(claude, 'skills', WIZARD_SKILL, file), file);
  for (const file of DEBUGGING_FILES) writeFile(path.join(claude, 'skills', DEBUGGING_SKILL, file), file);
  for (const file of SHADCN_FILES) writeFile(path.join(claude, 'skills', SHADCN_SKILL, file), file);
  writeFile(path.join(claude, 'settings.json'), settingsFor(home));
  // The repo fixture is not a git clone, so `git ls-remote` fails and the check reports
  // the installed version without a comparison — which is the offline path, exercised free.
  writeFile(path.join(claude, STATE_FILE), JSON.stringify({ version: VERSION, repo: path.join(home, 'repo') }));
}

// what --with-workflow adds on both sides at once: the rule plus every skill it names
function installWorkflowFiles(home, repo) {
  for (const root of [repo, path.join(home, '.claude')]) {
    writeFile(path.join(root, 'rules', WORKFLOW_RULE), WORKFLOW_RULE);
    for (const skill of ['ralph-protocol', ...HANDOFF_SKILLS, ...OPTIMIZE_SKILLS]) writeFile(path.join(root, 'skills', skill, 'SKILL.md'), skill);
  }
}

// The doctor fixture is never a git clone, so runChecks only ever exercises the offline
// path. The comparison itself is tested directly, and the bare form is what install.mjs
// records against tags that carry the `v`.
test('compares a recorded version against a tag, in either form', () => {
  assert.ok(compareTags('v1.1.0', '1.0.0') > 0);
  assert.equal(compareTags('v1.0.0', '1.0.0'), 0);
  assert.ok(compareTags('v1.0.0', '1.1.0') < 0);
  assert.ok(compareTags('v10.0.0', '9.0.0') > 0);
  assert.equal(compareTags('v1-sol', '1.0.0'), 0, 'an unsortable tag never wins');
});

function check(checks, name) {
  return checks.find((c) => c.name === name);
}

function run(home, repo, env = {}) {
  return runChecks({ home, repo, env });
}

test('passes for a complete default install', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);

  const summary = summarize(run(home, makeRepoFixture()));

  assert.equal(summary.fail, 0);
  assert.equal(summary.warn, 0);
  assert.ok(summary.pass >= 7);
});

// Without this the doctor reads ~/.claude while the installer wrote somewhere else, and
// reports a healthy install by inspecting files nothing is using.
test('reads the config dir the environment names when no home is given', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    const checks = runChecks({ repo: makeRepoFixture() });
    assert.equal(check(checks, 'installed hooks').level, 'pass');
    assert.equal(check(checks, 'agents').level, 'pass');
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
});

test('warns when an earlier install is still sitting in ~/.claude', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);

  const stale = check(runChecks({ home, repo: makeRepoFixture(), claudeDir: temp('consigliere-moved-') }), 'stale install');

  assert.equal(stale.level, 'warn');
  assert.match(stale.detail, /Claude Code no longer reads it/);
});

test('passes when the workflow rule ships with every skill it names', () => {
  const home = temp('consigliere-doctor-');
  const repo = makeRepoFixture();
  installDefaultFiles(home);
  installWorkflowFiles(home, repo);

  const assets = check(run(home, repo), 'workflow assets');

  assert.equal(assets.level, 'pass');
});

// The rule names the handoff skills, so a partial install leaves it pointing at
// something that is not there — the failure the whole check exists to catch.
test('warns when the workflow rule is installed without a skill it names', () => {
  const home = temp('consigliere-doctor-');
  const repo = makeRepoFixture();
  installDefaultFiles(home);
  installWorkflowFiles(home, repo);
  fs.rmSync(path.join(home, '.claude', 'skills', HANDOFF_SKILLS[0]), { recursive: true });

  const assets = check(run(home, repo), 'workflow assets');

  assert.equal(assets.level, 'warn');
  assert.match(assets.detail, new RegExp(`${HANDOFF_SKILLS[0]}/SKILL\\.md`));
});

test('warns when an installed hook no longer matches the repo copy', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  writeFile(path.join(home, '.claude', 'hooks', 'orchestrator-gate.mjs'), 'edited by hand');

  const hooks = check(run(home, makeRepoFixture()), 'installed hooks');

  assert.equal(hooks.level, 'warn');
  assert.match(hooks.detail, /orchestrator-gate\.mjs/);
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
  settings.hooks.PreToolUse[0].hooks[0].command = 'echo orchestrator-gate.mjs';
  writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify(settings));

  const entries = check(run(home, makeRepoFixture()), 'settings hooks');

  assert.equal(entries.level, 'warn');
  assert.match(entries.detail, /PreToolUse\/Edit\|Write\|MultiEdit:orchestrator-gate\.mjs/);
});

test('warns when the installer command is registered twice for one entry', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const block = settings.hooks.PreToolUse[0];
  block.hooks.push({ ...block.hooks[0], command: 'echo orchestrator-gate.mjs' });
  writeFile(settingsPath, JSON.stringify(settings));

  const entries = check(run(home, makeRepoFixture()), 'settings hooks');

  assert.equal(entries.level, 'warn');
  assert.match(entries.detail, /exactly once.*PreToolUse\/Edit\|Write\|MultiEdit:orchestrator-gate\.mjs/);
});

test('reports missing and wrongly registered entries together', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.hooks.PreToolUse[0].hooks[0].command = 'echo orchestrator-gate.mjs';
  settings.hooks.UserPromptSubmit = [];
  writeFile(settingsPath, JSON.stringify(settings));

  const entries = check(run(home, makeRepoFixture()), 'settings hooks');

  assert.equal(entries.level, 'warn');
  assert.match(entries.detail, /missing: UserPromptSubmit:git-discipline\.mjs/);
  assert.match(entries.detail, /exactly once.*PreToolUse\/Edit\|Write\|MultiEdit:orchestrator-gate\.mjs/);
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

// orchestrator-gate.mjs blocks the root's source edits and names these roles as the way
// through, so a gate installed without them is a lock with no key — the check says so.
test('warns when a subagent is missing, naming what breaks', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  fs.rmSync(path.join(home, '.claude', 'agents', AGENT_FILES[0]));

  const agents = check(run(home, makeRepoFixture()), 'agents');

  assert.equal(agents.level, 'warn');
  assert.match(agents.detail, new RegExp(`missing: ${AGENT_FILES[0]}`));
  assert.match(agents.detail, /orchestrator-gate\.mjs will block the root's source edits/);
});

test('warns about a locally customized subagent instead of certifying it', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  writeFile(path.join(home, '.claude', 'agents', AGENT_FILES[0]), 'my own version');

  const agents = check(run(home, makeRepoFixture()), 'agents');

  assert.equal(agents.level, 'warn');
  assert.match(agents.detail, new RegExp(`customized locally.*${AGENT_FILES[0]}`));
});

test('fails when the repo itself is missing a subagent', () => {
  const home = temp('consigliere-doctor-');
  const repo = makeRepoFixture();
  installDefaultFiles(home);
  fs.rmSync(path.join(repo, 'agents', AGENT_FILES[0]));

  const assets = check(run(home, repo), 'repo assets');

  assert.equal(assets.level, 'fail');
  assert.match(assets.detail, new RegExp(`agents/${AGENT_FILES[0]}`));
});

// what --with-release-permissions leaves on both sides: the flag in the state file, the
// rules in settings.json
function recordReleasePermissions(home, permissions) {
  const claude = path.join(home, '.claude');
  const state = JSON.parse(fs.readFileSync(path.join(claude, STATE_FILE), 'utf8'));
  writeFile(path.join(claude, STATE_FILE), JSON.stringify({ ...state, flags: ['--with-release-permissions'] }));
  const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
  writeFile(path.join(claude, 'settings.json'), JSON.stringify({ ...settings, permissions }));
}

test('warns when a rule you opted into is no longer in settings.permissions.allow', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  recordReleasePermissions(home, { allow: RELEASE_PERMISSIONS.slice(1) });

  const permissions = check(run(home, makeRepoFixture()), 'release permissions');

  assert.equal(permissions.level, 'warn');
  assert.ok(permissions.detail.includes(RELEASE_PERMISSIONS[0]));
});

// Listing the eight as missing would point at a rerun that skips this file too.
test('names the unusable shape instead of calling every rule missing', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  recordReleasePermissions(home, { allow: 'Bash(git push:*)' });

  const permissions = check(run(home, makeRepoFixture()), 'release permissions');

  assert.equal(permissions.level, 'warn');
  assert.match(permissions.detail, /settings\.permissions\.allow is not an array/);
  assert.equal(permissions.detail.includes(RELEASE_PERMISSIONS[1]), false, 'and lists no rule as missing');
});

test('says nothing when every rule you opted into is there', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  recordReleasePermissions(home, { allow: RELEASE_PERMISSIONS });

  assert.equal(check(run(home, makeRepoFixture()), 'release permissions'), undefined);
});

// settings.json has its own check; naming all eight on top of it points at a rerun that
// would only recreate the file.
test('says nothing about release permissions when there is no settings.json to read', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  recordReleasePermissions(home, { allow: RELEASE_PERMISSIONS });
  fs.rmSync(path.join(home, '.claude', 'settings.json'));

  assert.equal(check(run(home, makeRepoFixture()), 'release permissions'), undefined);
});

// Not opting in is a decision, and an allow list of your own is none of this tool's business.
test('says nothing about release permissions when the flag was never passed', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);

  assert.equal(check(run(home, makeRepoFixture()), 'release permissions'), undefined);
});

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

// ships by default like yagni, and the script is the half that actually runs
test('warns when the implement workflow was never installed', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  fs.rmSync(path.join(home, '.claude', 'skills', IMPLEMENT_SKILL), { recursive: true });

  const skill = check(run(home, makeRepoFixture()), 'implement-review-verify skill');

  assert.equal(skill.level, 'warn');
  assert.match(skill.detail, /not installed \(SKILL\.md, implement-review-verify\.js\)/);
  assert.match(skill.detail, /ignore this if you removed it on purpose/);
});

test('warns about a locally customized implement workflow script instead of certifying it', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  writeFile(path.join(home, '.claude', 'skills', IMPLEMENT_SKILL, 'implement-review-verify.js'), 'my own version');

  const skill = check(run(home, makeRepoFixture()), 'implement-review-verify skill');

  assert.equal(skill.level, 'warn');
  assert.match(skill.detail, /customized locally.*implement-review-verify\.js/);
});

// the library, not SKILL.md, is what every generated wizard runs on
test('warns about a locally customized wizard template instead of certifying it', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  writeFile(path.join(home, '.claude', 'skills', WIZARD_SKILL, 'template.sh'), 'my own version');

  const skill = check(run(home, makeRepoFixture()), 'wizard skill');

  assert.equal(skill.level, 'warn');
  assert.match(skill.detail, /customized locally.*template\.sh/);
});

// the pair is one feature, so losing either half is the same finding
test('warns when half of the grilling pair is missing', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  fs.rmSync(path.join(home, '.claude', 'skills', GRILLING_SKILLS[1]), { recursive: true });

  const skill = check(run(home, makeRepoFixture()), 'grilling skills');

  assert.equal(skill.level, 'warn');
  assert.match(skill.detail, new RegExp(`${GRILLING_SKILLS[1]}/SKILL\\.md`));
  assert.match(skill.detail, /ignore this if you removed it on purpose/);
});

test('warns when the shadcn skill was never installed', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  fs.rmSync(path.join(home, '.claude', 'skills', SHADCN_SKILL), { recursive: true });

  const skill = check(run(home, makeRepoFixture()), 'shadcn skill');

  assert.equal(skill.level, 'warn');
  assert.match(skill.detail, /not installed/);
  assert.match(skill.detail, /ignore this if you removed it on purpose/);
});

test('warns about a locally customized shadcn rule instead of certifying it', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  writeFile(path.join(home, '.claude', 'skills', SHADCN_SKILL, 'rules', 'forms.md'), 'my own version');

  const skill = check(run(home, makeRepoFixture()), 'shadcn skill');

  assert.equal(skill.level, 'warn');
  assert.match(skill.detail, /customized locally.*rules\/forms\.md/);
});

test('warns for a recommended key with no value, and only for that key', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const [envKey] = Object.keys(RECOMMENDED_ENV);
  const [otherEnvKey] = Object.keys(RECOMMENDED_ENV).slice(1);
  delete settings.env[envKey];
  settings.env[otherEnvKey] = 'a value of my own';
  writeFile(settingsPath, JSON.stringify(settings));

  const recommended = check(run(home, makeRepoFixture()), 'recommended settings');

  assert.equal(recommended.level, 'warn');
  assert.match(recommended.detail, new RegExp(`env\\.${envKey}`));
  // a key you set to something else is not a finding — the installer never overwrites one
  assert.doesNotMatch(recommended.detail, new RegExp(`env\\.${otherEnvKey}`));
});

test('reports the recommended keys instead of crashing on an env of the wrong type', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.env = 'not an object';
  writeFile(settingsPath, JSON.stringify(settings));

  const recommended = check(run(home, makeRepoFixture()), 'recommended settings');

  assert.equal(recommended.level, 'warn');
  assert.match(recommended.detail, /env\.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING/);
});

// The root decides and delegates, which is the one seat the topology needs at the top
// model; a downgrade here is silent everywhere else.
test('warns when the root is not on the recommended model', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.model = 'claude-sonnet-5';
  writeFile(settingsPath, JSON.stringify(settings));

  const model = check(run(home, makeRepoFixture()), 'root model');

  assert.equal(model.level, 'warn');
  assert.match(model.detail, new RegExp(`model is "claude-sonnet-5".*${RECOMMENDED_SETTINGS.model}`));

  delete settings.model;
  writeFile(settingsPath, JSON.stringify(settings));
  assert.match(check(run(home, makeRepoFixture()), 'root model').detail, /model is unset/);
});

// One env var that outranks the effort: line in all five agent files at once.
test('warns when a global effort level overrides the agent files', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);

  const model = check(run(home, makeRepoFixture(), { CLAUDE_CODE_EFFORT_LEVEL: 'medium' }), 'root model');

  assert.equal(model.level, 'warn');
  assert.match(model.detail, /CLAUDE_CODE_EFFORT_LEVEL/);
});

// Each agent file carries its own model:, so either of these silently flattens all five
// to one model — a value of your own does not make that acceptable.
test('warns when either subagent model key overrides the agent files', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);

  for (const key of ['CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE']) {
    const model = check(run(home, makeRepoFixture(), { [key]: '1' }), 'root model');
    assert.equal(model.level, 'warn', key);
    assert.match(model.detail, new RegExp(key));
  }

  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE = '1';
  writeFile(settingsPath, JSON.stringify(settings));

  assert.equal(check(run(home, makeRepoFixture()), 'root model').level, 'warn', 'settings.env counts too');
});

// A teammate spawn appends the agent file to the default prompt instead of replacing it and
// inherits the root's effort; the fresh context and the per-role effort both need it off.
test('warns when the agent teams flag is set, and stays quiet when it is not', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);

  const warned = check(run(home, makeRepoFixture(), { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }), 'root model');

  assert.equal(warned.level, 'warn');
  assert.match(warned.detail, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS/);

  const quiet = check(run(home, makeRepoFixture()), 'root model');

  assert.equal(quiet.level, 'pass');
  assert.doesNotMatch(quiet.detail, /CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS/);
});

// Claude Code writes settings.env over the shell, so an empty value there is how you
// unset a stale export. Reading the shell first reported an override that is not live.
test('lets settings.env override the shell for the force flag', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE = '';
  writeFile(settingsPath, JSON.stringify(settings));

  const model = check(run(home, makeRepoFixture(), { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }), 'root model');

  assert.equal(model.level, 'pass');
});

test('warns when the built-in advisor tool runs alongside this topology', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.advisorModel = 'opus';
  // the recommended env disables the tool, so only removing it reaches the warning
  delete settings.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL;
  writeFile(settingsPath, JSON.stringify(settings));

  const model = check(run(home, makeRepoFixture()), 'root model');

  assert.equal(model.level, 'warn');
  assert.match(model.detail, /advisorModel is "opus"/);
  assert.match(model.detail, /\/advisor off/);
});

test('stays quiet about advisorModel when the tool is disabled', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.advisorModel = 'opus';
  writeFile(settingsPath, JSON.stringify(settings));

  assert.equal(check(run(home, makeRepoFixture()), 'root model').level, 'pass');
});

test('reads the disable key as a flag, so "0" still warns', () => {
  const home = temp('consigliere-doctor-');
  installDefaultFiles(home);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.advisorModel = 'opus';
  settings.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL = '0';
  writeFile(settingsPath, JSON.stringify(settings));

  assert.equal(check(run(home, makeRepoFixture()), 'root model').level, 'warn');
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
