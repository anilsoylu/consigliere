import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { runChecks, summarize } from '../doctor.mjs';

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-doctor-'));
}

function writeFile(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeRepoFixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-repo-'));
  for (const hook of ['advisor-inject.mjs', 'advisor-mark.mjs', 'advisor-gate.mjs', 'advisor-watchdog.sh']) {
    writeFile(path.join(repo, 'hooks', hook));
  }
  for (const rule of ['advisor-executor.md', 'coding-discipline.md']) {
    writeFile(path.join(repo, 'rules', rule));
  }
  writeFile(path.join(repo, 'install.mjs'));
  writeFile(path.join(repo, 'uninstall.mjs'));
  return repo;
}

function installDefaultFiles(home) {
  const claude = path.join(home, '.claude');
  for (const hook of ['advisor-inject.mjs', 'advisor-mark.mjs', 'advisor-gate.mjs', 'advisor-watchdog.sh']) {
    writeFile(path.join(claude, 'hooks', hook));
  }
  fs.chmodSync(path.join(claude, 'hooks', 'advisor-watchdog.sh'), 0o755);
  for (const rule of ['advisor-executor.md', 'coding-discipline.md']) {
    writeFile(path.join(claude, 'rules', rule));
  }
  writeFile(
    path.join(claude, 'settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "advisor-mark.mjs"' }] },
          { matcher: 'Task', hooks: [{ type: 'command', command: 'node "advisor-mark.mjs"' }] },
          { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'node "advisor-gate.mjs"' }] },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'node "advisor-inject.mjs"' }] },
        ],
      },
    })
  );
  writeFile(path.join(claude, 'plugins', 'cache', 'openai-codex', 'codex', '1.0.0', 'scripts', 'codex-companion.mjs'));
  writeFile(path.join(home, '.codex', 'config.toml'), 'web_search = "disabled"\n');
}

test('runChecks passes for a complete default install', () => {
  const home = makeTempHome();
  const repo = makeRepoFixture();
  installDefaultFiles(home);

  const checks = runChecks({ home, repo, platform: 'darwin', nodeVersion: 'v26.0.0' });
  const summary = summarize(checks);

  assert.equal(summary.fail, 0);
  assert.equal(summary.warn, 0);
  assert.ok(summary.pass >= 8);
});

test('runChecks reports invalid settings JSON as a failure', () => {
  const home = makeTempHome();
  const repo = makeRepoFixture();
  writeFile(path.join(home, '.claude', 'settings.json'), '{not-json');

  const checks = runChecks({ home, repo, platform: 'darwin', nodeVersion: 'v26.0.0' });

  assert.ok(checks.some((check) => check.level === 'fail' && check.name === 'settings.json'));
});

test('runChecks warns when installed hook entries are missing', () => {
  const home = makeTempHome();
  const repo = makeRepoFixture();
  writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));

  const checks = runChecks({ home, repo, platform: 'darwin', nodeVersion: 'v26.0.0' });

  assert.ok(checks.some((check) => check.level === 'warn' && check.name === 'settings hooks'));
});
