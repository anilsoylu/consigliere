#!/usr/bin/env node
// SessionStart: say one line when a newer consigliere tag exists upstream, so an update
// surfaces by itself instead of the user handing Claude the repo and asking.
//
// The check never runs in the foreground. The hook reads a cached answer and exits; a
// detached child does the network work and writes the result for the NEXT session. That
// is why an offline machine costs nothing and session start is never delayed.
//
// `git ls-remote` against the installing clone rather than the GitHub API: it matches the
// release mechanism (plain tags, no Releases), needs no rate-limit thinking, and a fork
// checks its own origin instead of silently checking upstream.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const STATE = path.join(os.homedir(), '.claude', '.consigliere-state.json');
const DAY = 24 * 60 * 60 * 1000;

const read = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } };
const write = (state) => { try { fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n'); } catch {} };

// Only N.N.N sorts. The repo carries a `v1-sol` tag from an older era that must not win.
// The `v` is optional because tags carry it and the recorded VERSION does not.
const parse = (tag) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag)?.slice(1).map(Number);
function cmp(a, b) {
  const [x, y] = [parse(a), parse(b)];
  if (!x || !y) return 0;
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

if (process.argv[2] === '--child') {
  const state = read();
  if (state?.repo) {
    try {
      const out = execFileSync('git', ['ls-remote', '--tags', 'origin'], {
        cwd: state.repo, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'],
      });
      const tags = out.split('\n')
        .map((line) => line.split('refs/tags/')[1])
        .filter((tag) => tag && parse(tag))
        .sort(cmp);
      // Re-read: the parent stamped checkedAt after this child started.
      if (tags.length) write({ ...read(), latest: tags[tags.length - 1] });
    } catch {}
  }
  process.exit(0);
}

if (process.env.CONSIGLIERE_NO_UPDATE_CHECK || process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) process.exit(0);

const state = read();
if (!state?.version) process.exit(0);

if (Date.now() - (state.checkedAt || 0) > DAY) {
  // Stamped here, not in the child: if only a successful fetch advanced it, a machine that
  // is offline or has moved its clone would spawn a doomed child on every session forever.
  write({ ...state, checkedAt: Date.now() });
  // stdio: 'ignore' is load-bearing — an inherited pipe keeps this hook's parent waiting.
  spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { detached: true, stdio: 'ignore' }).unref();
}

if (state.latest && cmp(state.latest, state.version) > 0) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        `consigliere ${state.latest} is out; ${state.version} is installed. `
        + `Update with: cd ${state.repo} && git pull && node install.mjs — `
        + 'mention it once if the user has a moment, and do not interrupt the task for it.',
    },
  }));
}
