#!/usr/bin/env node
// Consigliere installer — OS-agnostic (macOS / Linux / Windows).
// Copies the advisor subagent, the hooks and the rules into ~/.claude, and idempotently
// merges the hook entries into settings.json (never clobbers your existing hooks).
// Safe to re-run: a second run changes nothing. Backs up any file it edits.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { VERSION, STATE_FILE, HOOK_FILES, AGENT_FILES, DEFAULT_RULES, WORKFLOW_RULE, HOOK_ENTRIES, HANDOFF_SKILLS, HANDOFF_FILES, GRILLING_SKILLS, GRILLING_FILES, OPTIMIZE_SKILLS, OPTIMIZE_FILES, MERGE_READINESS_SKILL, MERGE_READINESS_FILES, YAGNI_SKILL, YAGNI_FILES, WIZARD_SKILL, WIZARD_FILES, DEBUGGING_SKILL, DEBUGGING_FILES, SHADCN_SKILL, SHADCN_FILES, RECOMMENDED_ENV, RECOMMENDED_SETTINGS, CONTEXT_MODE, hookCommand, hasRalphLoop, hasContextMode } from './manifest.mjs';

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
  for (const f of files) {
    const src = path.join(srcDir, f);
    const dest = path.join(destDir, f);
    // per file, not once per skill: a manifest entry may be a nested path like rules/forms.md
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && !fs.readFileSync(dest).equals(fs.readFileSync(src))) backup(dest);
    fs.copyFileSync(src, dest);
  }
}

// --- 1. Prerequisite check for the optional workflow rule ---
// --with-workflow ships rules/workflow.md plus every skill it names, one of which is
// ralph-protocol, whose bounded execution loop runs on the ralph-loop plugin.
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
  // Same reason as ralph-protocol: workflow.md orders these three by name.
  for (const skill of HANDOFF_SKILLS) copyAll(HANDOFF_FILES, path.join(REPO, 'skills', skill), path.join(SKILLS, skill));
  log(`copied the handoff skills → ~/.claude/skills (${HANDOFF_SKILLS.map((s) => `/${s}`).join(', ')}; upstream brooklyn-skills, see README for attribution)`);
  // optimize and perf route to each other by name, and the rule's handoff order is what
  // fires optimize unprompted — so the pair rides the rule's flag.
  for (const skill of OPTIMIZE_SKILLS) copyAll(OPTIMIZE_FILES, path.join(REPO, 'skills', skill), path.join(SKILLS, skill));
  log(`copied the optimize pair → ~/.claude/skills (${OPTIMIZE_SKILLS.map((s) => `/${s}`).join(', ')})`);
} else {
  log('skipped rules/workflow.md + the ralph-protocol, handoff and optimize skills — add them with:  node install.mjs --with-workflow');
}

// The skill invokes its Workflow script by path, so the two ship together or the
// reference dangles. Opt-in on its own flag: a run costs up to 13 premium agents.
if (withMergeReadiness) {
  copyAll(MERGE_READINESS_FILES, path.join(REPO, 'skills', MERGE_READINESS_SKILL), path.join(SKILLS, MERGE_READINESS_SKILL));
  log(`copied skills/${MERGE_READINESS_SKILL} → ~/.claude/skills (run it with /${MERGE_READINESS_SKILL} once Claude Code restarts)`);
} else {
  log(`skipped the ${MERGE_READINESS_SKILL} review graph — add it with:  node install.mjs --with-${MERGE_READINESS_SKILL}`);
}

// No flag: advisor-executor.md (a default rule) and the advisor-inject banner both call
// for grilling by name, and grill-me is only the slash wrapper that runs it.
for (const skill of GRILLING_SKILLS) copyAll(GRILLING_FILES, path.join(REPO, 'skills', skill), path.join(SKILLS, skill));
log(`copied the grilling pair → ~/.claude/skills (${GRILLING_SKILLS.map((s) => `/${s}`).join(', ')}; upstream mattpocock/skills, see README for attribution)`);

// No flag: it is the enforcement pass for rules/coding-discipline.md, which is already a
// default rule, and it costs nothing until you run /yagni.
copyAll(YAGNI_FILES, path.join(REPO, 'skills', YAGNI_SKILL), path.join(SKILLS, YAGNI_SKILL));
log(`copied skills/${YAGNI_SKILL} → ~/.claude/skills (run it with /${YAGNI_SKILL} once Claude Code restarts)`);

// No flag: it is model-invoked on any bug, so a missing one cannot be asked for.
copyAll(DEBUGGING_FILES, path.join(REPO, 'skills', DEBUGGING_SKILL), path.join(SKILLS, DEBUGGING_SKILL));
log(`copied skills/${DEBUGGING_SKILL} → ~/.claude/skills (upstream obra/superpowers, see README for attribution)`);

// No flag: like yagni, it is inert until you run /wizard.
copyAll(WIZARD_FILES, path.join(REPO, 'skills', WIZARD_SKILL), path.join(SKILLS, WIZARD_SKILL));
log(`copied skills/${WIZARD_SKILL} → ~/.claude/skills (run it with /${WIZARD_SKILL}; upstream mattpocock/skills, see README for attribution)`);

// shadcn/ui's skill, carrying this repo's edits to its rules. Model-invoked rather than
// a slash command, so it costs nothing until Claude is actually working on shadcn code.
copyAll(SHADCN_FILES, path.join(REPO, 'skills', SHADCN_SKILL), path.join(SKILLS, SHADCN_SKILL));
log(`copied skills/${SHADCN_SKILL} → ~/.claude/skills (upstream shadcn/ui; see README for attribution)`);

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
// An entry an older version of this installer wrote, under an (event, matcher) the
// manifest no longer lists, would otherwise run forever — nothing else ever removes one.
// Matched by the exact command this installer writes, so a wrapper of yours around the
// same script survives; settings.json was backed up above, so this is recoverable.
function pruneStale() {
  const wanted = HOOK_ENTRIES.map(([e, m, s]) => `${e}\0${m || ''}\0${hookCommand(HOOKS, s)}`);
  const removed = [];
  for (const [event, blocks] of Object.entries(settings.hooks)) {
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      block.hooks = (block.hooks || []).filter((h) => {
        const mine = HOOK_FILES.some((s) => h.command === hookCommand(HOOKS, s));
        if (!mine || wanted.includes(`${event}\0${block.matcher || ''}\0${h.command}`)) return true;
        removed.push(`${event}${block.matcher ? `/${block.matcher}` : ''}`);
        return false;
      });
    }
    settings.hooks[event] = blocks.filter((b) => (b.hooks || []).length > 0);
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  return removed;
}

// Fills in the settings this loop is tuned against, and only where you have no value of
// your own — a key you already set is yours, even when it disagrees with ours. Returns
// the keys it added so the run says exactly what changed in your settings.json.
function fillDefaults(target, defaults, prefix) {
  const filled = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (key in target) continue;
    target[key] = value;
    filled.push(`${prefix}${key}=${value}`);
  }
  return filled;
}

let added = 0;
for (const [event, matcher, script] of HOOK_ENTRIES) added += ensureHook(event, matcher, script) ? 1 : 0;
const stale = pruneStale();
// an env that is not an object is yours to fix — writing into it would throw, and
// replacing it would destroy whatever you meant by it
settings.env ??= {};
const usableEnv = settings.env !== null && typeof settings.env === 'object' && !Array.isArray(settings.env);
if (!usableEnv) warn('settings.json has an "env" that is not an object; left it alone and skipped the recommended env keys.');
const filled = [
  ...(usableEnv ? fillDefaults(settings.env, RECOMMENDED_ENV, 'env.') : []),
  ...fillDefaults(settings, RECOMMENDED_SETTINGS, ''),
];
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
log(added ? `merged ${added} hook entr${added === 1 ? 'y' : 'ies'} into settings.json` : 'settings.json already had all hook entries (no change)');
if (stale.length) log(`removed ${stale.length} stale hook entr${stale.length === 1 ? 'y' : 'ies'} this installer no longer registers (${stale.join(', ')})`);
if (filled.length) {
  log(`set ${filled.length} recommended setting${filled.length === 1 ? '' : 's'} that had no value of yours: ${filled.join(', ')}`);
  log('these take effect on the next `claude` start; the backup above has your previous settings.json');
} else {
  log('settings.json already had every recommended env key and setting (no change)');
}

// --- 4. context-mode, if you want it ---
// Not installed here by design: /plugin shows a trust prompt before running someone
// else's code, and writing enabledPlugins from a script would answer that prompt for
// you. Printed instead, so the decision stays yours.
if (!hasContextMode(settings)) {
  log(`optional: ${CONTEXT_MODE.plugin} keeps raw tool output out of the context window. Run these in Claude Code:`);
  for (const c of CONTEXT_MODE.commands) log(`    ${c}`);
  log(`    then restart Claude Code (or /reload-plugins) and check it with ${CONTEXT_MODE.verify}`);
} else if (!settings.statusLine) {
  // printed, not written: statusLine is one slot and a whole terminal row, so an empty
  // one means "no bar", not "no opinion". See README for why the command may not resolve.
  log(`${CONTEXT_MODE.plugin} is enabled and you have no statusLine. Its savings bar is this, added by hand:`);
  log(`    "statusLine": ${JSON.stringify(CONTEXT_MODE.statusLine)}`);
}

// --- 5. Version stamp for update-check.mjs ---
// The installed side carries no manifest, so the hook has nothing to compare against
// unless the installer leaves the version and the clone it came from behind. `latest` is
// dropped on every install: it describes a comparison against a version now superseded.
const statePath = path.join(CLAUDE, STATE_FILE);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
// checkedAt goes back to 0 with it: a cache from before this install describes a
// comparison against the version it just replaced, so the next session should re-check.
fs.writeFileSync(statePath, JSON.stringify({ ...state, version: VERSION, repo: REPO, latest: null, checkedAt: 0 }, null, 2) + '\n');
log(`recorded version ${VERSION} in ~/.claude/${STATE_FILE} — update-check.mjs compares it against this clone's tags once a day`);

// --- 6. Leftovers from the Codex Sol era (tag v1-sol) ---
const watchdog = path.join(HOOKS, 'advisor-watchdog.sh');
if (fs.existsSync(watchdog)) {
  warn(`${watchdog} is left over from the Codex Sol advisor and nothing references it now.`);
  warn('Nothing here reads it, so it is inert — delete it by hand when you want it gone.');
}

log('done. Restart Claude Code (plain `claude`) so the agent, rules and hooks load. See README for how the loop works.');
