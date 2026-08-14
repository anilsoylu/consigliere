// The installer overwrites files in a HOME it does not own. These tests pin the one
// promise that makes that safe: anything you customized is backed up before it goes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { HOOK_FILES, AGENT_FILES, DEFAULT_RULES, WORKFLOW_RULE, HANDOFF_SKILLS, GRILLING_SKILLS, GRILLING_FILES, OPTIMIZE_SKILLS, YAGNI_SKILL, YAGNI_FILES, SHADCN_SKILL, SHADCN_FILES, RECOMMENDED_ENV, RECOMMENDED_SETTINGS, hookCommand } from '../manifest.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.join(REPO, 'install.mjs');
const temps = [];

test.after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function install(home = null, flags = []) {
  const dir = home ?? fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-install-'));
  if (!home) temps.push(dir);
  execFileSync(process.execPath, [INSTALL, ...flags], { env: { ...process.env, HOME: dir }, stdio: 'pipe' });
  return dir;
}

const read = (p) => fs.readFileSync(p, 'utf8');
const hookPath = (home, f) => path.join(home, '.claude', 'hooks', f);
const agentPath = (home, f) => path.join(home, '.claude', 'agents', f);
const rulePath = (home, f) => path.join(home, '.claude', 'rules', f);
const yagniPath = (home, f) => path.join(home, '.claude', 'skills', YAGNI_SKILL, f);

// Upgrading is the only way to end up with an entry the manifest no longer lists, and
// upgrading runs this installer — so the installer is where it has to be healed.
test('removes a stale entry it once wrote and keeps a hook of yours on the same matcher', () => {
  const home = install();
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const hooks = path.join(home, '.claude', 'hooks');
  const settings = JSON.parse(read(settingsPath));
  // exactly what the previous release registered, next to two entries that must survive:
  // a hook of the user's own, and a wrapper of theirs around one of our scripts
  settings.hooks.PreToolUse.push({
    matcher: 'Bash',
    hooks: [
      { type: 'command', command: hookCommand(hooks, 'advisor-mark.mjs') },
      { type: 'command', command: 'node /somewhere/else/my-own-hook.mjs' },
      { type: 'command', command: `node /my/shim.mjs ${path.join(hooks, 'advisor-mark.mjs')}` },
    ],
  });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  install(home);

  const after = JSON.parse(read(settingsPath));
  const bash = after.hooks.PreToolUse.find((b) => b.matcher === 'Bash');
  const commands = bash.hooks.map((h) => h.command);
  assert.equal(commands.includes(hookCommand(hooks, 'advisor-mark.mjs')), false, 'the stale entry must be gone');
  assert.equal(commands.length, 2, 'both of the user\'s entries must survive');
  const task = after.hooks.PreToolUse.find((b) => b.matcher === 'Task');
  assert.ok(task.hooks.some((h) => h.command === hookCommand(hooks, 'advisor-mark.mjs')), 'the listed entry must stay');
});

test('leaves a block empty of our entries out of settings.json entirely', () => {
  const home = install();
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const hooks = path.join(home, '.claude', 'hooks');
  const settings = JSON.parse(read(settingsPath));
  settings.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: hookCommand(hooks, 'advisor-mark.mjs') }] });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  install(home);

  const after = JSON.parse(read(settingsPath));
  assert.equal(after.hooks.PreToolUse.some((b) => b.matcher === 'Bash'), false, 'no {matcher, hooks: []} litter');
});

// copyAll() used to create the destination directory once, which is enough for a flat
// skill and silently wrong for this one — every rules/*.md would throw ENOENT.
test('copies a skill laid out in subdirectories, bytes intact', () => {
  const home = install();

  for (const f of SHADCN_FILES) {
    const installed = path.join(home, '.claude', 'skills', SHADCN_SKILL, f);
    assert.ok(fs.existsSync(installed), `skills/${SHADCN_SKILL}/${f} should be installed`);
    assert.ok(
      fs.readFileSync(installed).equals(fs.readFileSync(path.join(REPO, 'skills', SHADCN_SKILL, f))),
      `skills/${SHADCN_SKILL}/${f} must match this repo byte for byte`
    );
  }
});

// workflow.md orders these skills by name, so shipping the rule without them is the
// same dangling reference as a gate installed without its agent.
test('--with-workflow ships the rule together with every skill it names', () => {
  const home = install(null, ['--with-workflow']);

  assert.ok(fs.existsSync(rulePath(home, WORKFLOW_RULE)), 'the workflow rule should be installed');
  for (const skill of [...HANDOFF_SKILLS, ...OPTIMIZE_SKILLS]) {
    const installed = path.join(home, '.claude', 'skills', skill, 'SKILL.md');
    assert.ok(fs.existsSync(installed), `skills/${skill}/SKILL.md should be installed`);
    assert.ok(
      fs.readFileSync(installed).equals(fs.readFileSync(path.join(REPO, 'skills', skill, 'SKILL.md'))),
      `skills/${skill}/SKILL.md must match this repo byte for byte`
    );
  }
});

test('a default install ships neither the workflow rule nor the skills it names', () => {
  const home = install();

  assert.equal(fs.existsSync(rulePath(home, WORKFLOW_RULE)), false, 'the rule is behind the flag');
  for (const skill of [...HANDOFF_SKILLS, ...OPTIMIZE_SKILLS]) {
    assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', skill)), false, `${skill} is behind the flag too`);
  }
});

// The default rule and the inject banner call for grilling by name, so a default
// install without the pair would carry dangling references.
test('a default install ships the grilling pair, bytes intact', () => {
  const home = install();

  for (const skill of GRILLING_SKILLS) {
    for (const f of GRILLING_FILES) {
      const installed = path.join(home, '.claude', 'skills', skill, f);
      assert.ok(fs.existsSync(installed), `skills/${skill}/${f} should be installed`);
      assert.ok(
        fs.readFileSync(installed).equals(fs.readFileSync(path.join(REPO, 'skills', skill, f))),
        `skills/${skill}/${f} must match this repo byte for byte`
      );
    }
  }
});

test('fills in the recommended settings and never overwrites a value of yours', () => {
  const home = install();
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const first = JSON.parse(read(settingsPath));
  for (const [key, value] of Object.entries(RECOMMENDED_ENV)) assert.equal(first.env[key], value, `env.${key}`);
  for (const [key, value] of Object.entries(RECOMMENDED_SETTINGS)) assert.equal(first[key], value, key);

  const [envKey] = Object.keys(RECOMMENDED_ENV);
  const [topKey] = Object.keys(RECOMMENDED_SETTINGS);
  first.env[envKey] = 'mine';
  first[topKey] = 'mine';
  fs.writeFileSync(settingsPath, JSON.stringify(first, null, 2));

  install(home);

  const after = JSON.parse(read(settingsPath));
  assert.equal(after.env[envKey], 'mine', 'an env value you set must survive a reinstall');
  assert.equal(after[topKey], 'mine', 'a setting you set must survive a reinstall');
});

// `key in target` throws on a primitive, so an env of the wrong type would take the
// installer down after it had already copied files and rewritten hooks.
test('survives an env that is not an object, and leaves it as you wrote it', () => {
  const home = install();
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(read(settingsPath));
  settings.env = 'not an object';
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  install(home);

  const after = JSON.parse(read(settingsPath));
  assert.equal(after.env, 'not an object', 'the installer must not rewrite it');
  assert.ok(after.hooks.PreToolUse.length, 'the rest of the merge must still have happened');
});

// The regression: install.mjs used to copy hooks with no backup at all, so a customized
// hook was destroyed on the next install while a customized rule was carefully preserved.
for (const [label, live, repoFile, file] of [
  ['hook', hookPath, (f) => path.join(REPO, 'hooks', f), HOOK_FILES[0]],
  ['agent', agentPath, (f) => path.join(REPO, 'agents', f), AGENT_FILES[0]],
  ['rule', rulePath, (f) => path.join(REPO, 'rules', f), DEFAULT_RULES[0]],
  ['skill file', yagniPath, (f) => path.join(REPO, 'skills', YAGNI_SKILL, f), YAGNI_FILES[0]],
]) {
  test(`backs up a customized ${label} instead of overwriting it silently`, () => {
    const home = install();
    const target = live(home, file);
    fs.writeFileSync(target, 'my own version\n');

    install(home);

    assert.equal(read(`${target}.consigliere.bak`), 'my own version\n', 'the .bak must hold what the user wrote');
    assert.equal(read(target), read(repoFile(file)), 'the live file must be back to this repo bytes');
  });

  test(`keeps the first backup of a ${label} when you reinstall again`, () => {
    const home = install();
    const target = live(home, file);
    fs.writeFileSync(target, 'first edit\n');
    install(home);
    fs.writeFileSync(target, 'second edit\n');

    install(home);

    // backup() writes only when no .bak exists, so the earliest customization survives
    assert.equal(read(`${target}.consigliere.bak`), 'first edit\n');
  });

  test(`writes no ${label} backup when nothing drifted`, () => {
    const home = install();

    install(home);

    assert.equal(fs.existsSync(`${live(home, file)}.consigliere.bak`), false);
  });
}
