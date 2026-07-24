#!/usr/bin/env node
// Consigliere installer — OS-agnostic (macOS / Linux / Windows-with-bash).
// Copies the hooks + rule into ~/.claude, idempotently merges the hook entries into
// settings.json (never clobbers your existing hooks), and offers to disable Codex web
// search. Safe to re-run: a second run changes nothing. Backs up any file it edits.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const REPO = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE = path.join(HOME, '.claude');
const HOOKS = path.join(CLAUDE, 'hooks');
const RULES = path.join(CLAUDE, 'rules');
const SETTINGS = path.join(CLAUDE, 'settings.json');
const CODEX_CONF = path.join(HOME, '.codex', 'config.toml');
const withWorkflow = process.argv.slice(2).includes('--with-workflow');

const log = (...a) => console.log('[consigliere]', ...a);
const warn = (...a) => console.warn('[consigliere] WARN:', ...a);

function backup(file) {
  const bak = `${file}.consigliere.bak`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) {
    fs.copyFileSync(file, bak);
    log(`backed up ${path.basename(file)} → ${path.basename(bak)}`);
  }
}

// --- 1. Prerequisite: the codex-plugin-cc companion must exist ---
function findCompanion() {
  const base = path.join(CLAUDE, 'plugins', 'cache', 'openai-codex', 'codex');
  if (!fs.existsSync(base)) return null;
  const versions = fs.readdirSync(base).sort().reverse();
  for (const v of versions) {
    const p = path.join(base, v, 'scripts', 'codex-companion.mjs');
    if (fs.existsSync(p)) return p;
  }
  return null;
}
if (!findCompanion()) {
  warn('openai/codex-plugin-cc not found. Consigliere needs it for the Codex Sol advisor.');
  warn('Install it in Claude Code:  /plugin install codex@openai-codex   (and sign in with `codex login` / ChatGPT Plus).');
  warn('Continuing install anyway — hooks will be in place once the plugin is added.');
}

// --with-workflow ships rules/workflow.md, whose Ralph protocol runs on the ralph-loop plugin.
function hasRalphLoop() {
  return [
    path.join(CLAUDE, 'plugins', 'cache', 'claude-plugins-official', 'ralph-loop'),
    path.join(CLAUDE, 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins', 'ralph-loop'),
  ].some((p) => fs.existsSync(p));
}
if (withWorkflow && !hasRalphLoop()) {
  warn('ralph-loop plugin not found. rules/workflow.md drives its bounded execution loop through it.');
  warn('Install it in Claude Code:  /plugin install ralph-loop@claude-plugins-official');
  warn('Continuing install anyway — the rest of the rule works, but /ralph-loop and /cancel-ralph will not exist.');
}

// --- 2. Copy hooks + rules ---
fs.mkdirSync(HOOKS, { recursive: true });
fs.mkdirSync(RULES, { recursive: true });
const HOOK_FILES = ['advisor-inject.mjs', 'advisor-mark.mjs', 'advisor-gate.mjs', 'advisor-watchdog.sh'];
for (const f of HOOK_FILES) {
  fs.copyFileSync(path.join(REPO, 'hooks', f), path.join(HOOKS, f));
}
try { fs.chmodSync(path.join(HOOKS, 'advisor-watchdog.sh'), 0o755); } catch {}
const RULE_FILES = ['advisor-executor.md', 'coding-discipline.md'];
if (withWorkflow) RULE_FILES.push('workflow.md');
for (const f of RULE_FILES) {
  const src = path.join(REPO, 'rules', f);
  const dest = path.join(RULES, f);
  // you may already have a rule by this name — keep a copy before overwriting it
  if (fs.existsSync(dest) && !fs.readFileSync(dest).equals(fs.readFileSync(src))) backup(dest);
  fs.copyFileSync(src, dest);
}
log(`copied ${HOOK_FILES.length} hooks → ~/.claude/hooks and ${RULE_FILES.length} rules → ~/.claude/rules`);
if (!withWorkflow) {
  log('skipped rules/workflow.md (bounded Ralph loop + tasks/todo.md protocol) — add it with:  node install.mjs --with-workflow');
}

// --- 3. Idempotent settings.json merge (never clobbers existing hooks) ---
let settings = {};
if (fs.existsSync(SETTINGS)) {
  backup(SETTINGS);
  try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
  catch { warn('settings.json is not valid JSON; aborting merge. Fix it and re-run.'); process.exit(1); }
}
settings.hooks ??= {};

function hookCmd(script) { return `node "${path.join(HOOKS, script)}"`; }
function ensureHook(event, matcher, script) {
  settings.hooks[event] ??= [];
  const present = settings.hooks[event].some(b =>
    (matcher ? b.matcher === matcher : !b.matcher) &&
    (b.hooks || []).some(h => (h.command || '').includes(script)));
  if (present) return false;
  let block = settings.hooks[event].find(b => (matcher ? b.matcher === matcher : !b.matcher));
  if (!block) { block = matcher ? { matcher, hooks: [] } : { hooks: [] }; settings.hooks[event].push(block); }
  block.hooks ??= [];
  block.hooks.push({ type: 'command', command: hookCmd(script) });
  return true;
}
let added = 0;
added += ensureHook('PreToolUse', 'Bash', 'advisor-mark.mjs') ? 1 : 0;
added += ensureHook('PreToolUse', 'Task', 'advisor-mark.mjs') ? 1 : 0;
added += ensureHook('PreToolUse', 'Edit|Write|MultiEdit', 'advisor-gate.mjs') ? 1 : 0;
added += ensureHook('UserPromptSubmit', null, 'advisor-inject.mjs') ? 1 : 0;
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
log(added ? `merged ${added} hook entr${added === 1 ? 'y' : 'ies'} into settings.json` : 'settings.json already had all hook entries (no change)');

// --- 4. Offer web_search="disabled" in Codex config ---
if (fs.existsSync(CODEX_CONF)) {
  const conf = fs.readFileSync(CODEX_CONF, 'utf8');
  if (/^\s*web_search\s*=/m.test(conf)) {
    log('~/.codex/config.toml already sets web_search (no change)');
  } else {
    backup(CODEX_CONF);
    const note = '# consigliere: disables Codex web search so the advisor cannot hang on "Searching:"\nweb_search = "disabled"\n\n';
    fs.writeFileSync(CODEX_CONF, note + conf);
    log('added web_search="disabled" to ~/.codex/config.toml (prevents Codex hang)');
  }
} else {
  warn('~/.codex/config.toml not found — skipping web_search tweak. After `codex login`, add:  web_search = "disabled"');
}

// --- 5. Windows note ---
if (process.platform === 'win32') {
  warn('Windows: the advisor watchdog is a bash script. Run Claude Code from Git Bash / WSL so it can execute; pure PowerShell cannot run it.');
}

log('done. Restart Claude Code (plain `claude`) so the rule and hooks load. See README for how the loop works.');
