// What Consigliere installs and where it looks for its dependencies.
// install.mjs, uninstall.mjs, and doctor.mjs all read this, so the three cannot drift.
import fs from 'node:fs';
import path from 'node:path';

export const HOOK_FILES = ['advisor-inject.mjs', 'advisor-mark.mjs', 'advisor-gate.mjs', 'advisor-watchdog.sh'];
export const DEFAULT_RULES = ['advisor-executor.md', 'coding-discipline.md'];
export const WORKFLOW_RULE = 'workflow.md';

// [event, matcher, script] — matcher null means the block carries no matcher
export const HOOK_ENTRIES = [
  ['PreToolUse', 'Bash', 'advisor-mark.mjs'],
  ['PreToolUse', 'Task', 'advisor-mark.mjs'],
  ['PreToolUse', 'Edit|Write|MultiEdit', 'advisor-gate.mjs'],
  ['UserPromptSubmit', null, 'advisor-inject.mjs'],
];

// the exact command the installer writes into settings.json
export function hookCommand(hooksDir, script) {
  return `node "${path.join(hooksDir, script)}"`;
}

export function findCompanion(claudeDir) {
  const base = path.join(claudeDir, 'plugins', 'cache', 'openai-codex', 'codex');
  if (!fs.existsSync(base)) return null;
  for (const v of fs.readdirSync(base).sort().reverse()) {
    const p = path.join(base, v, 'scripts', 'codex-companion.mjs');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function hasRalphLoop(claudeDir) {
  return [
    path.join(claudeDir, 'plugins', 'cache', 'claude-plugins-official', 'ralph-loop'),
    path.join(claudeDir, 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins', 'ralph-loop'),
  ].some((p) => fs.existsSync(p));
}
