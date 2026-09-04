#!/usr/bin/env node
// Copies an approved plan-mode plan into the repo it plans.
//
// Claude Code already writes the plan, to a global ~/.claude/plans/<slug>.md named in a
// plan_mode transcript attachment. That file is machine-local and carries no project, so
// the plan is invisible to git, to a reviewer, and to the same user on another machine.
// ExitPlanMode itself carries no plan text — it only signals the file is ready — so the
// path comes from the transcript, not from tool_input.
//
// PostToolUse fires only after a tool completes successfully, and a rejected plan is a
// permission denial, so a rejected plan is never captured and no tool_response check is
// needed. Always exits 0: a hook that cannot capture must not block the turn.
import fs from 'node:fs';
import path from 'node:path';

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

// The directory is the opt-in — this hook writes into your working tree, so it stays
// inert until you make the target once. Walked up from cwd rather than trusting it: plan
// mode often starts in a package dir, and cwd alone would scatter plans across a monorepo.
// A worktree's .git is a file, so existence is the test, not isDirectory.
function targetDir(from) {
  let dir = path.resolve(from || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      const target = path.join(dir, 'plans', 'plan-mode');
      return fs.existsSync(target) ? target : null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// Last attachment wins: a session can enter plan mode more than once, and the newest is
// the one just approved. Unparseable lines are skipped rather than fatal — a transcript
// is appended to while this runs.
function planFile(transcript) {
  let lines;
  try { lines = fs.readFileSync(transcript, 'utf8').split('\n'); } catch { return null; }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('plan_mode')) continue;
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry.attachment?.type === 'plan_mode' && entry.attachment.planFilePath) {
      return entry.attachment.planFilePath;
    }
  }
  return null;
}

const dir = targetDir(payload.cwd);
if (!dir) process.exit(0);
const src = planFile(payload.transcript_path);
if (!src || !fs.existsSync(src)) process.exit(0);

// Timestamped because the slug is fixed for the whole session: re-planning would
// otherwise overwrite the plan it replaced, and the point is to keep both.
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const dest = path.join(dir, `${stamp}-${path.basename(src)}`);
try {
  fs.copyFileSync(src, dest);
  console.error(`[consigliere] plan-capture: wrote ${dest}`);
} catch (error) {
  console.error(`[consigliere] plan-capture: cannot write ${dest}: ${error.message}`);
}
