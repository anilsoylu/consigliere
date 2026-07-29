#!/usr/bin/env node
// Read-only Consigliere installation diagnostics.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(fileURLToPath(import.meta.url));
const ADVISOR_HOOKS = ['advisor-inject.mjs', 'advisor-mark.mjs', 'advisor-gate.mjs', 'advisor-watchdog.sh'];
const DEFAULT_RULES = ['advisor-executor.md', 'coding-discipline.md'];

function exists(p) {
  return fs.existsSync(p);
}

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function major(version) {
  const match = String(version).match(/^v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

function findCompanion(claudeDir) {
  const base = path.join(claudeDir, 'plugins', 'cache', 'openai-codex', 'codex');
  if (!exists(base)) return null;

  for (const version of fs.readdirSync(base).sort().reverse()) {
    const candidate = path.join(base, version, 'scripts', 'codex-companion.mjs');
    if (exists(candidate)) return candidate;
  }

  return null;
}

function hasRalphLoop(claudeDir) {
  return [
    path.join(claudeDir, 'plugins', 'cache', 'claude-plugins-official', 'ralph-loop'),
    path.join(claudeDir, 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins', 'ralph-loop'),
  ].some(exists);
}

function parseSettings(settingsPath) {
  if (!exists(settingsPath)) {
    return { settings: null, error: null };
  }

  try {
    return { settings: JSON.parse(readText(settingsPath)), error: null };
  } catch (error) {
    return { settings: null, error };
  }
}

function hasHook(settings, event, matcher, script) {
  return (settings?.hooks?.[event] || []).some((block) =>
    (matcher ? block.matcher === matcher : !block.matcher) &&
    (block.hooks || []).some((hook) => String(hook.command || '').includes(script))
  );
}

function checkHookEntries(settings) {
  const expected = [
    ['PreToolUse', 'Bash', 'advisor-mark.mjs'],
    ['PreToolUse', 'Task', 'advisor-mark.mjs'],
    ['PreToolUse', 'Edit|Write|MultiEdit', 'advisor-gate.mjs'],
    ['UserPromptSubmit', null, 'advisor-inject.mjs'],
  ];
  const missing = expected
    .filter(([event, matcher, script]) => !hasHook(settings, event, matcher, script))
    .map(([event, matcher, script]) => `${event}${matcher ? `/${matcher}` : ''}:${script}`);

  return missing;
}

function status(level, name, detail) {
  return { level, name, detail };
}

export function runChecks(options = {}) {
  const home = options.home || process.env.CONSIGLIERE_HOME || os.homedir();
  const repo = options.repo || REPO;
  const platform = options.platform || process.platform;
  const nodeVersion = options.nodeVersion || process.version;
  const claudeDir = path.join(home, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const rulesDir = path.join(claudeDir, 'rules');
  const skillsDir = path.join(claudeDir, 'skills');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const codexConfigPath = path.join(home, '.codex', 'config.toml');
  const checks = [];

  checks.push(
    major(nodeVersion) >= 18
      ? status('pass', 'node', `${nodeVersion} supports the installer scripts`)
      : status('fail', 'node', `${nodeVersion} is too old; use Node 18 or newer`)
  );

  const missingRepoAssets = [
    ...ADVISOR_HOOKS.map((file) => path.join(repo, 'hooks', file)),
    ...DEFAULT_RULES.map((file) => path.join(repo, 'rules', file)),
    path.join(repo, 'install.mjs'),
    path.join(repo, 'uninstall.mjs'),
  ].filter((file) => !exists(file));

  checks.push(
    missingRepoAssets.length === 0
      ? status('pass', 'repo assets', 'required hook, rule, install, and uninstall files are present')
      : status('fail', 'repo assets', `missing: ${missingRepoAssets.map((file) => path.relative(repo, file)).join(', ')}`)
  );

  checks.push(
    exists(claudeDir)
      ? status('pass', 'claude directory', `${claudeDir} exists`)
      : status('warn', 'claude directory', `${claudeDir} does not exist yet; run Claude Code before or after install`)
  );

  const missingInstalledHooks = ADVISOR_HOOKS
    .map((file) => path.join(hooksDir, file))
    .filter((file) => !exists(file));
  checks.push(
    missingInstalledHooks.length === 0
      ? status('pass', 'installed hooks', 'all advisor hooks are installed')
      : status('warn', 'installed hooks', `missing: ${missingInstalledHooks.map((file) => path.basename(file)).join(', ')}`)
  );

  const missingInstalledRules = DEFAULT_RULES
    .map((file) => path.join(rulesDir, file))
    .filter((file) => !exists(file));
  checks.push(
    missingInstalledRules.length === 0
      ? status('pass', 'installed rules', 'default advisor rules are installed')
      : status('warn', 'installed rules', `missing: ${missingInstalledRules.map((file) => path.basename(file)).join(', ')}`)
  );

  const { settings, error } = parseSettings(settingsPath);
  if (error) {
    checks.push(status('fail', 'settings.json', `invalid JSON: ${error.message}`));
  } else if (!settings) {
    checks.push(status('warn', 'settings.json', `${settingsPath} does not exist yet`));
  } else {
    const missingHookEntries = checkHookEntries(settings);
    checks.push(
      missingHookEntries.length === 0
        ? status('pass', 'settings hooks', 'all advisor hook entries are registered')
        : status('warn', 'settings hooks', `missing entries: ${missingHookEntries.join(', ')}`)
    );
  }

  const companion = findCompanion(claudeDir);
  checks.push(
    companion
      ? status('pass', 'codex companion', `found ${companion}`)
      : status('warn', 'codex companion', 'not found; install in Claude Code with: /plugin install codex@openai-codex')
  );

  if (exists(codexConfigPath)) {
    const codexConfig = readText(codexConfigPath);
    checks.push(
      /^\s*web_search\s*=\s*["']disabled["']\s*$/m.test(codexConfig)
        ? status('pass', 'codex web search', 'web_search is disabled')
        : status('warn', 'codex web search', 'web_search is not disabled; advisor calls may hang on web search')
    );
  } else {
    checks.push(status('warn', 'codex config', `${codexConfigPath} does not exist yet`));
  }

  const watchdogPath = path.join(hooksDir, 'advisor-watchdog.sh');
  if (platform === 'win32') {
    checks.push(status('warn', 'watchdog shell', 'Windows needs Git Bash or WSL for advisor-watchdog.sh'));
  } else if (exists(watchdogPath)) {
    const executable = (fs.statSync(watchdogPath).mode & 0o111) !== 0;
    checks.push(
      executable
        ? status('pass', 'watchdog executable', 'advisor-watchdog.sh is executable')
        : status('warn', 'watchdog executable', 'advisor-watchdog.sh is not executable; rerun node install.mjs')
    );
  }

  const workflowRule = path.join(rulesDir, 'workflow.md');
  const ralphSkill = path.join(skillsDir, 'ralph-protocol', 'SKILL.md');
  if (exists(workflowRule) || exists(ralphSkill)) {
    checks.push(
      exists(workflowRule) && exists(ralphSkill)
        ? status('pass', 'workflow assets', 'workflow rule and ralph-protocol skill are installed together')
        : status('warn', 'workflow assets', 'workflow rule and ralph-protocol skill should be installed together')
    );
    checks.push(
      hasRalphLoop(claudeDir)
        ? status('pass', 'ralph-loop plugin', 'ralph-loop plugin is installed')
        : status('warn', 'ralph-loop plugin', 'optional plugin not found; /ralph-loop commands will not exist')
    );
  }

  return checks;
}

export function summarize(checks) {
  return {
    pass: checks.filter((check) => check.level === 'pass').length,
    warn: checks.filter((check) => check.level === 'warn').length,
    fail: checks.filter((check) => check.level === 'fail').length,
  };
}

function print(checks, { json = false } = {}) {
  const summary = summarize(checks);
  if (json) {
    console.log(JSON.stringify({ summary, checks }, null, 2));
    return;
  }

  for (const check of checks) {
    console.log(`[${check.level.toUpperCase()}] ${check.name} — ${check.detail}`);
  }
  console.log(`\nSummary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail`);
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const json = process.argv.includes('--json');
  const checks = runChecks();
  print(checks, { json });
  process.exit(summarize(checks).fail > 0 ? 1 : 0);
}
