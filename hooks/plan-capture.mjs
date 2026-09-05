#!/usr/bin/env node
// Copies an approved plan-mode plan into the repo it plans, as an /improve plan.
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

// advisor-plans/ wins, which is /improve's own answer for a repo whose plans/ already means
// something else; otherwise plans/ is created. Requiring the directory up front was the
// earlier design and it failed the obvious way — the plan for this very hook was dropped in
// silence, and nobody learns about a capture that never happened. Walked up from cwd rather
// than trusting it: plan mode often starts in a package dir, and cwd alone would scatter
// plans across a monorepo. A worktree's .git is a file, so existence is the test, not
// isDirectory. Outside a repo there is no root to write to, so nothing is created.
function targetDir(from) {
  let dir = path.resolve(from || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      const found = ['advisor-plans', 'plans']
        .map((name) => path.join(dir, name))
        .find((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory());
      if (found) return found;
      const made = path.join(dir, 'plans');
      // A regular file named `plans` lands here as EEXIST, same as an unwritable root.
      try { fs.mkdirSync(made, { recursive: true }); } catch (error) {
        console.error(`[consigliere] plan-capture: cannot create ${made}: ${error.message}`);
        return null;
      }
      return made;
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

// Appending is the only order a hook can know: the plan just approved is the next thing to
// run.
function nextNumber(dir) {
  const highest = fs.readdirSync(dir)
    .reduce((max, name) => Math.max(max, Number(name.match(/^(\d+)-/)?.[1] ?? 0)), 0);
  return String(highest + 1).padStart(3, '0');
}

const field = (text, name) =>
  text.match(new RegExp(`^- \\*\\*${name}\\*\\*: *(.+)$`, 'm'))?.[1].trim() || '—';

const HEADER = `# Implementation Plans

Execute in the order below unless dependencies say otherwise. Each executor: read the plan
fully before starting, honor its STOP conditions, and update your row when done.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
`;

const LEGEND = '\nStatus values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason)'
  + ' | REJECTED (with one-line rationale)\n';

// Without a row there is no status, and reconcile iterates the index by status — an
// unindexed plan is one /improve never picks up.
function addRow(dir, row) {
  const file = path.join(dir, 'README.md');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${HEADER + row}\n${LEGEND}`);
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let at = lines.findLastIndex((line) => /^\| *\d+ *\|/.test(line));
  if (at < 0) at = lines.findIndex((line) => /^\|[-| :]+\|$/.test(line));
  if (at < 0) {
    console.error(`[consigliere] plan-capture: no status table in ${file}; row skipped`);
    return;
  }
  lines.splice(at + 1, 0, row);
  fs.writeFileSync(file, lines.join('\n'));
}

const dir = targetDir(payload.cwd);
if (!dir) process.exit(0);
const src = planFile(payload.transcript_path);
if (!src) process.exit(0);
let text;
try { text = fs.readFileSync(src, 'utf8'); } catch { process.exit(0); }

const number = nextNumber(dir);
// The trailing strip catches a model that numbered the title itself; only the hook can
// know the number, so its own is the one that stands.
const title = (text.match(/^# +(.+)$/m)?.[1].trim() ?? path.basename(src, '.md'))
  .replace(/^Plan \d+: */, '');
const dest = path.join(dir, `${number}-${path.basename(src)}`);
try {
  // wx, never overwrite: a re-plan in the same session reuses the slug, and the point is
  // to keep both plans. Function replacer, or a `$&` in the title would splice.
  fs.writeFileSync(dest, text.replace(/^# +.+$/m, () => `# Plan ${number}: ${title}`), { flag: 'wx' });
} catch (error) {
  console.error(`[consigliere] plan-capture: cannot write ${dest}: ${error.message}`);
  process.exit(0);
}

const cell = (value) => value.replaceAll('|', '\\|');
try {
  addRow(dir, `| ${number} | ${cell(title)} | ${cell(field(text, 'Priority'))} `
    + `| ${cell(field(text, 'Effort'))} | ${cell(field(text, 'Depends on'))} | TODO |`);
} catch (error) {
  console.error(`[consigliere] plan-capture: cannot index ${dest}: ${error.message}`);
}
console.error(`[consigliere] plan-capture: wrote ${dest}`);
