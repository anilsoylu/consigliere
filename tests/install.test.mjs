// The installer overwrites files in a HOME it does not own. These tests pin the one
// promise that makes that safe: anything you customized is backed up before it goes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { HOOK_FILES, AGENT_FILES, DEFAULT_RULES, YAGNI_SKILL, YAGNI_FILES } from '../manifest.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.join(REPO, 'install.mjs');
const temps = [];

test.after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function install(home = null) {
  const dir = home ?? fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-install-'));
  if (!home) temps.push(dir);
  execFileSync(process.execPath, [INSTALL], { env: { ...process.env, HOME: dir }, stdio: 'pipe' });
  return dir;
}

const read = (p) => fs.readFileSync(p, 'utf8');
const hookPath = (home, f) => path.join(home, '.claude', 'hooks', f);
const agentPath = (home, f) => path.join(home, '.claude', 'agents', f);
const rulePath = (home, f) => path.join(home, '.claude', 'rules', f);
const yagniPath = (home, f) => path.join(home, '.claude', 'skills', YAGNI_SKILL, f);

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
