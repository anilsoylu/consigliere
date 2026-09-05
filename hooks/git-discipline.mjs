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
import { cfgDir } from './config-dir.mjs';
import { isApproval } from './approval.mjs';

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
const sid = payload.session_id || 'default';
const flag = path.join(os.tmpdir(), `handoff-${sid}.flag`);
const clear = () => {
  try { fs.rmSync(flag, { force: true }); }
  catch (error) { console.error(`[consigliere] git-discipline: cannot clear ${flag}: ${error.message}`); }
};

// The chain has two entry points: the model invokes the Skill tool (tool_input.skill,
// verified against live transcripts; name/command read as fallbacks for older payloads),
// and the user types the slash command, which reaches hooks only as a UserPromptSubmit
// prompt carrying `<command-name>/clean</command-name>` — never as a Skill call.
// Only the chain skills open the gate: optimize/perf run before it, and the rule still
// requires /clean after them, so marking on those would open the gate a step early.
const CHAIN = ['clean', 'pr-update', 'pr-ready'];
const PR_CREATE = /(?:^|[;&|\n]|\$\()\s*gh\s+pr\s+create\b/;
// Reported, not swallowed: a failed write shows up later as the gate blocking a handoff
// whose /clean already ran, with nothing in the transcript to explain it.
const mark = () => {
  try { fs.writeFileSync(flag, ''); }
  catch (error) { console.error(`[consigliere] git-discipline: cannot write ${flag}: ${error.message}`); }
};

// Compaction and resume rebuild the conversation from a summary, and the workflow rules are
// what the summary drops first — the reported failure is precisely "uzun konuşmalardan sonra
// sapıtıyor". startup and clear already read the rule file, so re-stating there is noise.
if (payload.hook_event_name === 'SessionStart') {
  if ((payload.source === 'compact' || payload.source === 'resume')
    && fs.existsSync(path.join(cfgDir(), 'rules', 'workflow.md'))) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: [
          'WORKFLOW RULES (re-stated: the context was rebuilt, and these are what a summary drops).',
          'Handoff: /clean → review → /pr-update opens a PR. One chain per PR, not per session.',
          'Branches: one per task, feat/ fix/ chore/ refactor/ + kebab. Never commit to main/master.',
          'Commits: conventional subjects — feat: / fix: / refactor: / test: / chore: / docs:.',
          'Verifiers: never pipe one through tail/head/grep — the filter\'s exit status hides a red run.',
          'Redirect instead: <verifier> > /tmp/<name>.log 2>&1; echo exit=$?, then grep the file.',
          'Anything slower than ~30s goes run_in_background: true. Never sleep to poll, never raise timeout.',
          'A backgrounded verifier is not finished until you have read its exit code.',
        ].join('\n'),
      },
    }));
  }
  process.exit(0);
}

if (payload.tool_name === 'Skill') {
  const raw = payload.tool_input?.skill ?? payload.tool_input?.name ?? payload.tool_input?.command ?? '';
  const name = String(raw).replace(/^\//, '').split(':').pop();
  if (CHAIN.includes(name)) mark();
  process.exit(0);
}
if (typeof payload.prompt === 'string' && payload.prompt !== '') {
  // The gate is per task, not per session. Without this the first /clean of a long session
  // opened it for every PR that followed — nine of them, in the transcript that prompted this.
  // Clearing before the chain test keeps a prompt that IS /clean marked.
  if (!isApproval(payload.prompt.trim())) clear();
  const typed = new RegExp(`(?:<command-name>|^\\s*)/(?:${CHAIN.join('|')})\\b`);
  if (typed.test(payload.prompt)) mark();
  process.exit(0);
}

// Per PR, not per prompt: the chain that opened this one does not cover the next. Cleared on
// the Post event rather than the Pre one so a denied or failed create does not consume it.
if (payload.hook_event_name === 'PostToolUse') {
  const ran = (payload.tool_name === 'Bash' && payload.tool_input?.command) || '';
  if (PR_CREATE.test(ran)) clear();
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

// `--force(?![-\w])` passes --force-with-lease and --force-if-includes. A refspec or remote
// never starts with a lone dash, so a short cluster containing f is a force push; the second
// dash of --force-with-lease stops [a-zA-Z]* before its f.
const push = cmd.match(/(?:^|[;&|\n]|\$\()\s*git\s+(?:-C\s+\S+\s+)?push\b([^;&|\n]*)/);
if (push && (/--force(?![-\w])/.test(push[1]) || /(?:^|\s)-[a-zA-Z]*f(?![-\w])/.test(push[1]))) {
  deny(
    'FORCE GATE: this pushes with a bare --force. rules/workflow.md: push rewritten history '
    + 'only with --force-with-lease, never bare --force — the lease is what refuses to '
    + 'overwrite a commit someone (or another session) pushed since your last fetch. '
    + 'Swap the flag and run the same push again.',
  );
}

if (/(?:^|[;&|\n]|\$\()\s*sleep\s+[\d.]/.test(cmd)) {
  deny(
    'WAIT GATE: sleep polls. rules/workflow.md: blocking costs the wall-clock of the sleep, '
    + 'not of the job, and the estimate is always too long. Run the job with '
    + 'run_in_background: true instead — the harness wakes you when it exits.',
  );
}

if (Number(payload.tool_input?.timeout) > 120000) {
  deny(
    `WAIT GATE: timeout ${payload.tool_input.timeout}ms exceeds the 120000ms default. `
    + 'rules/workflow.md: reaching for a bigger ceiling means you expect a long run, and an '
    + 'expected-long run belongs in the background. Drop the timeout and pass '
    + 'run_in_background: true.',
  );
}

// Split first: `npm test > /tmp/a.log; git log | head` is two commands the rules recommend,
// and testing the whole string would deny it. A mis-split inside a quoted string only fails
// open, since one segment must hold both a runner at its start and a filter.
const VERIFIER = /^\s*(?:\$\()?\s*(?:npx\s+|bunx\s+)?(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|build)|pytest|go\s+test|cargo\s+(?:test|build|clippy)|vitest|jest|tsc|eslint|node\s+--test)\b/;
if (cmd.split(/&&|\|\||;|\n/).some((seg) => VERIFIER.test(seg) && /\|\s*(?:tail|head|grep|rg)\b/.test(seg))) {
  deny(
    'VERIFIER GATE: this pipes a verifier through a filter. rules/workflow.md: the pipeline\'s '
    + 'exit status becomes the filter\'s, so a red run reads as green and $? lies — and the '
    + 'lines a filter drops are usually the failure itself. Redirect instead: '
    + '`<verifier> > /tmp/<name>.log 2>&1; echo "exit=$?"`, then grep the file.',
  );
}

// Only when the /clean skill is actually installed: the deny names skills by slash
// command, and naming an absent one turns the gate into a dead end.
if (PR_CREATE.test(cmd)
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
