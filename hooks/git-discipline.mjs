#!/usr/bin/env node
// PreToolUse(Bash|Skill) + UserPromptSubmit: enforce the git rules of rules/workflow.md
// at the three moments they are machine-visible — a commit on main/master, a
// non-conventional subject, and a PR opened without the /clean → review → /pr-update
// handoff. The prose alone did not hold; a rule with no detectable moment gets sampled,
// not obeyed.
//
// Self-gated on ~/.claude/rules/workflow.md: a default install (no --with-workflow)
// never ships that rule, so this hook stays silent rather than enforcing a doctrine
// the user never opted into.
//
// Anything unparseable fails OPEN, same as commit-language.mjs: a false positive
// blocks work no rewrite can unblock, which is how a hook earns being disabled.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function cfgDir() {
  const e = process.env.CLAUDE_CONFIG_DIR;
  if (e && e.trim() !== '') {
    return e.startsWith('~') ? path.resolve(os.homedir(), e.replace(/^~[/\\]?/, '')) : path.resolve(e);
  }
  return path.join(os.homedir(), '.claude');
}

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
const sid = payload.session_id || 'default';
const flag = path.join(os.tmpdir(), `handoff-${sid}.flag`);

// The chain has two entry points: the model invokes the Skill tool (tool_input.skill,
// verified against live transcripts; name/command read as fallbacks for older payloads),
// and the user types the slash command, which reaches hooks only as a UserPromptSubmit
// prompt carrying `<command-name>/clean</command-name>` — never as a Skill call.
// Only the chain skills open the gate: optimize/perf run before it, and the rule still
// requires /clean after them, so marking on those would open the gate a step early.
const CHAIN = ['clean', 'pr-update', 'pr-ready'];
// Reported, not swallowed: a failed write shows up later as the gate blocking a handoff
// whose /clean already ran, with nothing in the transcript to explain it.
const mark = () => {
  try { fs.writeFileSync(flag, ''); }
  catch (error) { console.error(`[consigliere] git-discipline: cannot write ${flag}: ${error.message}`); }
};

if (payload.tool_name === 'Skill') {
  const raw = payload.tool_input?.skill ?? payload.tool_input?.name ?? payload.tool_input?.command ?? '';
  const name = String(raw).replace(/^\//, '').split(':').pop();
  if (CHAIN.includes(name)) mark();
  process.exit(0);
}
if (typeof payload.prompt === 'string' && payload.prompt !== '') {
  const typed = new RegExp(`(?:<command-name>|^\\s*)/(?:${CHAIN.join('|')})\\b`);
  if (typed.test(payload.prompt)) mark();
  process.exit(0);
}

const cmd = (payload.tool_name === 'Bash' && payload.tool_input?.command) || '';
if (!cmd) process.exit(0);
const cfg = cfgDir();
if (!fs.existsSync(path.join(cfg, 'rules', 'workflow.md'))) process.exit(0);

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

// Exactly one -C is allowed before the subcommand, mirroring commit-language.mjs:
// a greedy flag matcher would start matching `git log -p commit..`. The command must
// sit at a shell position (start, separator, or substitution) — a PR body whose prose
// mentions `git commit` inside a heredoc must not read as one.
const commit = cmd.match(/(?:^|[;&|\n]|\$\()\s*git\s+(?:-C\s+(\S+)\s+)?commit\b/);
if (commit) {
  // `cd /other && git commit` moves the repo out from under payload.cwd, so the last
  // `cd` before the commit wins. Relative paths resolve against the session cwd.
  let dir = (commit[1] || '').replace(/^['"]|['"]$/g, '');
  if (!dir) {
    const cds = [...cmd.slice(0, commit.index).matchAll(/\bcd\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g)];
    const last = cds.at(-1);
    dir = last ? (last[1] ?? last[2] ?? last[3]) : '';
  }
  dir = dir ? path.resolve(payload.cwd || process.cwd(), dir) : (payload.cwd || process.cwd());
  let branch = '';
  try {
    branch = execFileSync('git', ['-C', dir, 'symbolic-ref', '-q', '--short', 'HEAD'],
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {} // detached HEAD, not a repo, no git — all fail open
  if (branch === 'main' || branch === 'master') {
    deny(
      `BRANCH GATE: this commit targets ${branch}. rules/workflow.md: one branch per task, `
      + 'never commit straight to the default branch. Create one first — '
      + '`git switch -c feat/<kebab-summary>` (or fix/ chore/ refactor/) — then run the same commit again.',
    );
  }

  // First -m wins; the heredoc form is the fallback for `-F- <<EOF` message bodies.
  // Nothing extracted (interactive, --amend --no-edit, -F file) or a subject the shell
  // will still expand (`$(...)`, backticks) → fail open. Extraction starts at the commit
  // itself, so an earlier command's quotes are never read as this commit's message.
  const rest = cmd.slice(commit.index);
  const dq = rest.match(/(?:-m|--message)(?:=|\s+)"((?:[^"\\]|\\.)*)"/);
  const sq = rest.match(/(?:-m|--message)(?:=|\s+)'([^']*)'/);
  const heredoc = rest.match(/<<-?\s*['"]?\w+['"]?\r?\n\s*([^\r\n]+)/);
  const subject = (dq?.[1] ?? sq?.[1] ?? heredoc?.[1] ?? '').split('\\n')[0].trim();
  if (subject && !/^[$`]/.test(subject)
    && !/^(?:(?:feat|fix|refactor|test|chore|docs)(?:\([^)]*\))?!?: \S|Merge |Revert |Reapply |fixup! |squash! )/.test(subject)) {
    deny(
      `SUBJECT GATE: "${subject.slice(0, 72)}" is not a conventional commit subject. `
      + 'rules/workflow.md requires `feat: … / fix: … / refactor: … / test: … / chore: … / docs: …`. '
      + 'Rewrite the subject and run the same commit again.',
    );
  }
}

// Only when the /clean skill is actually installed: the deny names skills by slash
// command, and naming an absent one turns the gate into a dead end.
if (/(?:^|[;&|\n]|\$\()\s*gh\s+pr\s+create\b/.test(cmd)
  && fs.existsSync(path.join(cfg, 'skills', 'clean', 'SKILL.md'))
  && !fs.existsSync(flag)) {
  deny(
    'HANDOFF GATE: no handoff skill has run this session. rules/workflow.md orders '
    + '/clean → review → /pr-update before a PR opens; /pr-update itself creates the PR. '
    + 'Run /optimize first instead when the diff adds a compute-heavy routine. '
    + 'Start the chain now — the gate opens on the first chain skill. If this deny arrives '
    + 'again right after /clean or /pr-update ran, the hook is broken rather than '
    + 'unsatisfied: say so and stop instead of re-running the chain.',
  );
}
