#!/usr/bin/env node
// Consigliere installer — OS-agnostic (macOS / Linux / Windows).
// Copies the advisor subagent, the hooks and the rules into ~/.claude, and idempotently
// merges the hook entries into settings.json (never clobbers your existing hooks).
// Safe to re-run: a second run changes nothing. Backs up any file it edits.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOOK_FILES, AGENT_FILES, DEFAULT_RULES, WORKFLOW_RULE, HOOK_ENTRIES, MERGE_READINESS_SKILL, MERGE_READINESS_FILES, YAGNI_SKILL, YAGNI_FILES, hookCommand, hasRalphLoop } from './manifest.mjs';

const HOME = os.homedir();
const REPO = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE = path.join(HOME, '.claude');
const HOOKS = path.join(CLAUDE, 'hooks');
const RULES = path.join(CLAUDE, 'rules');
const AGENTS = path.join(CLAUDE, 'agents');
const SKILLS = path.join(CLAUDE, 'skills');
const SETTINGS = path.join(CLAUDE, 'settings.json');
const withWorkflow = process.argv.slice(2).includes('--with-workflow');
const withMergeReadiness = process.argv.slice(2).includes('--with-merge-readiness');

const log = (...a) => console.log('[consigliere]', ...a);
const warn = (...a) => console.warn('[consigliere] WARN:', ...a);

function backup(file) {
  const bak = `${file}.consigliere.bak`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) {
    fs.copyFileSync(file, bak);
    log(`backed up ${path.basename(file)} → ${path.basename(bak)}`);
  }
}

// a file you customized is a file you meant to customize — keep a copy before overwriting.
// doctor.mjs reports the drift as meaningful; the installer must not destroy it silently.
function copyAll(files, srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of files) {
    const src = path.join(srcDir, f);
    const dest = path.join(destDir, f);
    if (fs.existsSync(dest) && !fs.readFileSync(dest).equals(fs.readFileSync(src))) backup(dest);
    fs.copyFileSync(src, dest);
  }
}

// --- 1. Prerequisite check for the optional workflow rule ---
// --with-workflow ships rules/workflow.md plus the ralph-protocol skill it defers to,
// whose bounded execution loop runs on the ralph-loop plugin.
if (withWorkflow && !hasRalphLoop(CLAUDE)) {
  warn('ralph-loop plugin not found. rules/workflow.md drives its bounded execution loop through it.');
  warn('Install it in Claude Code:  /plugin install ralph-loop@claude-plugins-official');
  warn('Continuing install anyway — the rest of the rule works, but /ralph-loop and /cancel-ralph will not exist.');
}

// --- 2. Copy the agent, the hooks and the rules ---
// The agent is not optional: advisor-gate.mjs blocks source edits and names this
// subagent as the way through, so a gate without an agent is a lock with no key.
copyAll(AGENT_FILES, path.join(REPO, 'agents'), AGENTS);
copyAll(HOOK_FILES, path.join(REPO, 'hooks'), HOOKS);
const RULE_FILES = [...DEFAULT_RULES];
if (withWorkflow) RULE_FILES.push(WORKFLOW_RULE);
copyAll(RULE_FILES, path.join(REPO, 'rules'), RULES);
log(`copied ${AGENT_FILES.length} agent → ~/.claude/agents, ${HOOK_FILES.length} hooks → ~/.claude/hooks and ${RULE_FILES.length} rules → ~/.claude/rules`);

// workflow.md keeps the Ralph details out of the always-loaded context by pointing at
// this skill, so the two must ship together or that reference dangles.
if (withWorkflow) {
  copyAll(['SKILL.md'], path.join(REPO, 'skills', 'ralph-protocol'), path.join(SKILLS, 'ralph-protocol'));
  log('copied skills/ralph-protocol → ~/.claude/skills (loaded on demand, not every session)');
} else {
  log('skipped rules/workflow.md + the ralph-protocol skill — add them with:  node install.mjs --with-workflow');
}

// The skill invokes its Workflow script by path, so the two ship together or the
// reference dangles. Opt-in on its own flag: a run costs up to 13 premium agents.
if (withMergeReadiness) {
  copyAll(MERGE_READINESS_FILES, path.join(REPO, 'skills', MERGE_READINESS_SKILL), path.join(SKILLS, MERGE_READINESS_SKILL));
  log(`copied skills/${MERGE_READINESS_SKILL} → ~/.claude/skills (run it with /${MERGE_READINESS_SKILL} once Claude Code restarts)`);
} else {
  log(`skipped the ${MERGE_READINESS_SKILL} review graph — add it with:  node install.mjs --with-${MERGE_READINESS_SKILL}`);
}

// No flag: it is the enforcement pass for rules/coding-discipline.md, which is already a
// default rule, and it costs nothing until you run /yagni.
copyAll(YAGNI_FILES, path.join(REPO, 'skills', YAGNI_SKILL), path.join(SKILLS, YAGNI_SKILL));
log(`copied skills/${YAGNI_SKILL} → ~/.claude/skills (run it with /${YAGNI_SKILL} once Claude Code restarts)`);

// --- 3. Idempotent settings.json merge (never clobbers existing hooks) ---
let settings = {};
if (fs.existsSync(SETTINGS)) {
  backup(SETTINGS);
  try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
  catch { warn('settings.json is not valid JSON; aborting merge. Fix it and re-run.'); process.exit(1); }
}
settings.hooks ??= {};

function ensureHook(event, matcher, script) {
  settings.hooks[event] ??= [];
  const present = settings.hooks[event].some(b =>
    (matcher ? b.matcher === matcher : !b.matcher) &&
    (b.hooks || []).some(h => (h.command || '').includes(script)));
  if (present) return false;
  let block = settings.hooks[event].find(b => (matcher ? b.matcher === matcher : !b.matcher));
  if (!block) { block = matcher ? { matcher, hooks: [] } : { hooks: [] }; settings.hooks[event].push(block); }
  block.hooks ??= [];
  block.hooks.push({ type: 'command', command: hookCommand(HOOKS, script) });
  return true;
}
let added = 0;
for (const [event, matcher, script] of HOOK_ENTRIES) added += ensureHook(event, matcher, script) ? 1 : 0;
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
log(added ? `merged ${added} hook entr${added === 1 ? 'y' : 'ies'} into settings.json` : 'settings.json already had all hook entries (no change)');

// --- 4. Leftovers from the Codex Sol era (tag v1-sol) ---
const watchdog = path.join(HOOKS, 'advisor-watchdog.sh');
if (fs.existsSync(watchdog)) {
  warn(`${watchdog} is left over from the Codex Sol advisor and nothing references it now.`);
  warn('Nothing here reads it, so it is inert — delete it by hand when you want it gone.');
}

log('done. Restart Claude Code (plain `claude`) so the agent, rules and hooks load. See README for how the loop works.');
