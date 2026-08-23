// The uninstaller deletes files and rewrites settings.json in a HOME it does not own.
// Two promises make that safe and neither had a test: anything you edited survives, and
// hooks that are not consigliere's are never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { HOOK_FILES, OBSOLETE_HOOK_FILES, AGENT_FILES, DEFAULT_RULES, HANDOFF_SKILLS, GRILLING_SKILLS, OPTIMIZE_SKILLS, YAGNI_SKILL, YAGNI_FILES, WIZARD_SKILL, DEBUGGING_SKILL, SHADCN_SKILL, hookCommand } from '../manifest.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.join(REPO, 'install.mjs');
const UNINSTALL = path.join(REPO, 'uninstall.mjs');
const temps = [];

test.after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function run(script, home, flags = []) {
  execFileSync(process.execPath, [script, ...flags], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: 'pipe' });
}

// a real install, so the fixture is whatever the installer actually writes today
function installed(flags = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-uninstall-'));
  temps.push(home);
  run(INSTALL, home, flags);
  return home;
}

const hookPath = (home, f) => path.join(home, '.claude', 'hooks', f);
const agentPath = (home, f) => path.join(home, '.claude', 'agents', f);
const rulePath = (home, f) => path.join(home, '.claude', 'rules', f);
const yagniPath = (home, f) => path.join(home, '.claude', 'skills', YAGNI_SKILL, f);
const settingsPath = (home) => path.join(home, '.claude', 'settings.json');
const readSettings = (home) => JSON.parse(fs.readFileSync(settingsPath(home), 'utf8'));

test('removes the files it placed, and running it twice is not an error', () => {
  const home = installed();

  run(UNINSTALL, home);
  run(UNINSTALL, home);

  for (const f of HOOK_FILES) assert.equal(fs.existsSync(hookPath(home, f)), false, `${f} should be gone`);
  for (const f of AGENT_FILES) assert.equal(fs.existsSync(agentPath(home, f)), false, `agents/${f} should be gone`);
  for (const f of DEFAULT_RULES) assert.equal(fs.existsSync(rulePath(home, f)), false, `${f} should be gone`);
  for (const f of YAGNI_FILES) assert.equal(fs.existsSync(yagniPath(home, f)), false, `yagni/${f} should be gone`);
  for (const skill of GRILLING_SKILLS) assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', skill)), false, `${skill} should be gone`);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', WIZARD_SKILL)), false, `${WIZARD_SKILL} should be gone`);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', DEBUGGING_SKILL)), false, `${DEBUGGING_SKILL} should be gone`);
});

// Uninstalling from a HOME that was never upgraded has to clear the old names too, or
// the leftover looks like consigliere is still partly installed.
test('sweeps a hook shipped by an earlier version', () => {
  const home = installed();
  const stale = hookPath(home, OBSOLETE_HOOK_FILES[0]);
  fs.writeFileSync(stale, 'old release\n');

  run(UNINSTALL, home);

  assert.equal(fs.existsSync(stale), false);
});

// rmdir on the skill root alone leaves rules/, agents/, assets/ and evals/ behind as
// empty directories, which reads as "still installed" to anyone looking.
test('prunes a skill directory down to nothing, subdirectories included', () => {
  const home = installed();
  const skill = path.join(home, '.claude', 'skills', SHADCN_SKILL);
  assert.ok(fs.existsSync(skill), 'fixture must have the skill installed');

  run(UNINSTALL, home);

  assert.equal(fs.existsSync(skill), false, 'no empty directory tree should be left');
});

// Installed behind a flag, so nothing else in this file would notice them being left
// behind after an uninstall.
test('removes the handoff skills the workflow flag installed', () => {
  const home = installed(['--with-workflow']);
  const dirs = [...HANDOFF_SKILLS, ...OPTIMIZE_SKILLS].map((s) => path.join(home, '.claude', 'skills', s));
  for (const dir of dirs) assert.ok(fs.existsSync(dir), `fixture must have ${path.basename(dir)} installed`);

  run(UNINSTALL, home);

  for (const dir of dirs) assert.equal(fs.existsSync(dir), false, `${path.basename(dir)} should be gone`);
});

// A file you edited is yours. The installer backs drift up; the uninstaller must not
// then delete the thing that backup was protecting.
for (const [label, live, file] of [
  ['hook', hookPath, HOOK_FILES[0]],
  ['agent', agentPath, AGENT_FILES[0]],
  ['rule', rulePath, DEFAULT_RULES[0]],
  ['yagni skill file', yagniPath, YAGNI_FILES[0]],
]) {
  test(`keeps a ${label} you customized instead of deleting it`, () => {
    const home = installed();
    const target = live(home, file);
    fs.writeFileSync(target, 'my own version\n');

    run(UNINSTALL, home);

    assert.equal(fs.readFileSync(target, 'utf8'), 'my own version\n');
  });
}

test('strips only its own hook entries and leaves an unrelated hook in the same block', () => {
  const home = installed();
  const settings = readSettings(home);
  // a third-party hook sharing consigliere's PreToolUse/Task block, plus an event
  // consigliere owns outright — the first must survive, the second must vanish entirely
  const mine = settings.hooks.PreToolUse.find((b) => b.matcher === 'Task|SendMessage');
  mine.hooks.push({ type: 'command', command: 'node /somewhere/else/my-own-hook.mjs' });
  fs.writeFileSync(settingsPath(home), JSON.stringify(settings, null, 2));

  run(UNINSTALL, home);

  const after = readSettings(home);
  const commands = JSON.stringify(after.hooks ?? {});
  assert.match(commands, /my-own-hook\.mjs/, 'an unrelated hook must survive');
  for (const f of HOOK_FILES) assert.equal(commands.includes(f), false, `${f} should no longer be registered`);
  assert.equal('UserPromptSubmit' in (after.hooks ?? {}), false, 'an event left empty must be dropped, not kept as []');
  assert.equal(after.hooks.PreToolUse.length, 1, 'blocks left empty must be dropped too');
});

test('leaves an invalid settings.json byte-identical and still exits clean', () => {
  const home = installed();
  const broken = 'sk-ant-SECRET123 not json';
  fs.writeFileSync(settingsPath(home), broken);

  run(UNINSTALL, home);

  assert.equal(fs.readFileSync(settingsPath(home), 'utf8'), broken);
});

test('installs cleanly again after an uninstall', () => {
  const home = installed();
  run(UNINSTALL, home);

  run(INSTALL, home);

  const registered = readSettings(home).hooks.UserPromptSubmit
    .some((b) => !b.matcher && b.hooks.some((h) => h.command === hookCommand(path.join(home, '.claude', 'hooks'), 'advisor-inject.mjs')));
  assert.ok(registered, 'advisor-inject.mjs should be registered again');
  assert.ok(fs.existsSync(hookPath(home, HOOK_FILES[0])));
});
