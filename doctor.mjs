#!/usr/bin/env node
// Read-only Consigliere installation diagnostics. Reads files, writes none.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOOK_FILES, DEFAULT_RULES, WORKFLOW_RULE, HOOK_ENTRIES, MERGE_READINESS_SKILL, MERGE_READINESS_FILES, hookCommand, findCompanion, hasRalphLoop } from './manifest.mjs';

const REPO = path.dirname(fileURLToPath(import.meta.url));
const USAGE = `Usage: node doctor.mjs [--json]

Read-only check of a Consigliere install. Exits non-zero only on hard failures
(missing repo assets, unusable settings.json); an incomplete install is a
warning — fix it by re-running node install.mjs.`;

const exists = (p) => fs.existsSync(p);
const status = (level, name, detail) => ({ level, name, detail });
const list = (files) => files.join(', ');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameBytes = (a, b) => exists(a) && exists(b) && fs.readFileSync(a).equals(fs.readFileSync(b));

// A file that exists but no longer matches this repo is not the file you think is in use.
function compare(files, srcDir, destDir) {
  const missing = [];
  const modified = [];
  for (const f of files) {
    const dest = path.join(destDir, f);
    if (!exists(dest)) missing.push(f);
    else if (!sameBytes(path.join(srcDir, f), dest)) modified.push(f);
  }
  return { missing, modified };
}

function parseSettings(settingsPath) {
  if (!exists(settingsPath)) return { present: false };
  try {
    return { present: true, settings: JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  } catch (error) {
    // Node quotes the offending bytes in its message; settings.json can hold API keys
    const where = /at position \d+[^)]*\)?/.exec(error.message);
    return { present: true, error: where ? where[0] : 'position unknown' };
  }
}

// Valid JSON can still be a shape the installer never writes and Claude Code cannot use.
function shapeProblem(settings) {
  if (!isObject(settings)) return 'the file must hold a JSON object';
  const hooks = settings.hooks;
  if (hooks === undefined) return null;
  if (!isObject(hooks)) return 'hooks must be an object';
  for (const [event, blocks] of Object.entries(hooks)) {
    if (!Array.isArray(blocks)) return `hooks.${event} must be an array`;
    for (const [i, block] of blocks.entries()) {
      if (!isObject(block)) return `hooks.${event}[${i}] must be an object`;
      if (!Array.isArray(block.hooks)) return `hooks.${event}[${i}].hooks must be an array`;
      const bad = block.hooks.findIndex((hook) => !isObject(hook));
      if (bad !== -1) return `hooks.${event}[${i}].hooks[${bad}] must be an object`;
    }
  }
  return null;
}

// Every match counts: a second entry for the same script runs the script a second time.
// Runs only after shapeProblem() cleared the tree, so the shapes here are known good.
function findEntries(settings, event, matcher, script) {
  return (settings.hooks?.[event] || [])
    .filter((block) => (matcher ? block.matcher === matcher : !block.matcher))
    .flatMap((block) => block.hooks.filter((hook) => String(hook.command || '').includes(script)));
}

// Inside a basic string \""" is text, not a delimiter; a literal ''' string has no escapes.
function delimiters(line, delimiter) {
  const text = delimiter === '"""' ? line.replace(/\\./g, '') : line;
  return text.split(delimiter).length - 1;
}

// A single top-level assignment, or Codex may still search the web on the value that wins.
function webSearchState(toml) {
  let table = '';
  let quoted = null; // inside a ''' or """ block, where a web_search line is just text
  const found = [];
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (quoted) {
      if (delimiters(line, quoted)) quoted = null;
      continue;
    }

    const header = /^\[+(.+?)\]+\s*(#.*)?$/.exec(line);
    if (header) table = header[1];
    else {
      const assignment = /^web_search\s*=\s*(.+?)\s*(#.*)?$/.exec(line);
      if (assignment) found.push({ table, value: assignment[1] });
    }
    quoted = ['"""', "'''"].find((d) => delimiters(line, d) % 2 === 1) || null;
  }

  const top = found.filter((f) => !f.table);
  if (!found.length) return status('warn', 'codex web search', 'web_search is not set; advisor calls may hang on web search');
  if (top.length !== 1) {
    return status('warn', 'codex web search', top.length
      ? `web_search is assigned ${top.length} times at the top level; leave one`
      : `web_search is only set under [${found[0].table}], which does not disable the tool`);
  }
  return /^(["']disabled["']|false)$/.test(top[0].value)
    ? status('pass', 'codex web search', 'web_search is disabled')
    : status('warn', 'codex web search', `web_search = ${top[0].value}; set it to "disabled" or advisor calls may hang`);
}

export function runChecks(options = {}) {
  const home = options.home || os.homedir();
  const repo = options.repo || REPO;
  const platform = options.platform || process.platform;
  const claudeDir = path.join(home, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const rulesDir = path.join(claudeDir, 'rules');
  const skillsDir = path.join(claudeDir, 'skills');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const codexConfigPath = path.join(home, '.codex', 'config.toml');
  const checks = [];

  const missingRepoAssets = [
    ...HOOK_FILES.map((f) => path.join(repo, 'hooks', f)),
    ...DEFAULT_RULES.map((f) => path.join(repo, 'rules', f)),
    path.join(repo, 'install.mjs'),
    path.join(repo, 'uninstall.mjs'),
  ].filter((file) => !exists(file));

  checks.push(
    missingRepoAssets.length === 0
      ? status('pass', 'repo assets', 'required hook, rule, install, and uninstall files are present')
      : status('fail', 'repo assets', `missing: ${list(missingRepoAssets.map((f) => path.relative(repo, f)))}`)
  );

  checks.push(
    exists(claudeDir)
      ? status('pass', 'claude directory', `${claudeDir} exists`)
      : status('warn', 'claude directory', `${claudeDir} does not exist yet; run Claude Code before or after install`)
  );

  const hooks = compare(HOOK_FILES, path.join(repo, 'hooks'), hooksDir);
  checks.push(
    hooks.missing.length
      ? status('warn', 'installed hooks', `missing: ${list(hooks.missing)}; rerun node install.mjs`)
      : hooks.modified.length
        ? status('warn', 'installed hooks', `differ from this repo: ${list(hooks.modified)}; rerun node install.mjs to restore`)
        : status('pass', 'installed hooks', 'all advisor hooks are installed and match this repo')
  );

  // Editing a rule is legitimate — the uninstaller keeps those — but a pass has to mean verified.
  const rules = compare(DEFAULT_RULES, path.join(repo, 'rules'), rulesDir);
  checks.push(
    rules.missing.length
      ? status('warn', 'installed rules', `missing: ${list(rules.missing)}; rerun node install.mjs`)
      : rules.modified.length
        ? status('warn', 'installed rules', `customized locally, no longer this repo's: ${list(rules.modified)}`)
        : status('pass', 'installed rules', 'default advisor rules are installed and match this repo')
  );

  const { present, settings, error } = parseSettings(settingsPath);
  if (!present) {
    checks.push(status('warn', 'settings.json', `${settingsPath} does not exist yet`));
  } else if (error) {
    checks.push(status('fail', 'settings.json', `invalid JSON (${error}); fix it and re-run`));
  } else {
    const problem = shapeProblem(settings);
    if (problem) {
      checks.push(status('fail', 'settings.json', `unexpected shape: ${problem}`));
    } else {
      const missing = [];
      const wrong = [];
      for (const [event, matcher, script] of HOOK_ENTRIES) {
        const label = `${event}${matcher ? `/${matcher}` : ''}:${script}`;
        const candidates = findEntries(settings, event, matcher, script);
        const exact = candidates.filter((h) => h.type === 'command' && h.command === hookCommand(hooksDir, script));
        if (!candidates.length) missing.push(label);
        else if (candidates.length !== 1 || exact.length !== 1) wrong.push(label);
      }
      const problems = [];
      if (missing.length) problems.push(`missing: ${list(missing)} — rerun node install.mjs`);
      if (wrong.length) problems.push(`not registered exactly once with the installer's command: ${list(wrong)} — fix settings.json by hand`);
      checks.push(
        problems.length
          ? status('warn', 'settings hooks', problems.join('; '))
          : status('pass', 'settings hooks', 'all advisor hook entries are registered as installed')
      );
    }
  }

  const companion = findCompanion(claudeDir);
  checks.push(
    companion
      ? status('pass', 'codex companion', `found ${companion}`)
      : status('warn', 'codex companion', 'not found; install in Claude Code with: /plugin install codex@openai-codex')
  );

  if (exists(codexConfigPath)) {
    checks.push(webSearchState(fs.readFileSync(codexConfigPath, 'utf8')));
  } else {
    checks.push(status('warn', 'codex config', `${codexConfigPath} does not exist yet`));
  }

  const watchdogPath = path.join(hooksDir, 'advisor-watchdog.sh');
  if (platform === 'win32') {
    checks.push(status('warn', 'watchdog shell', 'Windows needs Git Bash or WSL for advisor-watchdog.sh'));
  } else if (exists(watchdogPath)) {
    checks.push(
      (fs.statSync(watchdogPath).mode & 0o111) !== 0
        ? status('pass', 'watchdog executable', 'advisor-watchdog.sh is executable')
        : status('warn', 'watchdog executable', 'advisor-watchdog.sh is not executable; rerun node install.mjs')
    );
  }

  // --with-workflow ships these two together; one without the other leaves a dangling reference
  const workflowRule = path.join(rulesDir, WORKFLOW_RULE);
  const ralphSkill = path.join(skillsDir, 'ralph-protocol', 'SKILL.md');
  if (exists(workflowRule) || exists(ralphSkill)) {
    const drifted = [
      ...compare([WORKFLOW_RULE], path.join(repo, 'rules'), rulesDir).modified,
      ...(exists(ralphSkill) && !sameBytes(path.join(repo, 'skills', 'ralph-protocol', 'SKILL.md'), ralphSkill)
        ? ['ralph-protocol/SKILL.md'] : []),
    ];
    checks.push(
      !exists(workflowRule) || !exists(ralphSkill)
        ? status('warn', 'workflow assets', 'workflow rule and ralph-protocol skill should be installed together')
        : drifted.length
          ? status('warn', 'workflow assets', `customized locally, no longer this repo's: ${list(drifted)}`)
          : status('pass', 'workflow assets', 'workflow rule and ralph-protocol skill are installed and match this repo')
    );
    checks.push(
      hasRalphLoop(claudeDir)
        ? status('pass', 'ralph-loop plugin', 'ralph-loop plugin is installed')
        : status('warn', 'ralph-loop plugin', 'optional plugin not found; /ralph-loop commands will not exist')
    );
  }

  // Optional feature, so only checked once it is present. The skill invokes the script
  // by path: one without the other is a command that fails when you run it.
  const mergeReadinessDir = path.join(skillsDir, MERGE_READINESS_SKILL);
  if (exists(mergeReadinessDir)) {
    const skill = compare(MERGE_READINESS_FILES, path.join(repo, 'skills', MERGE_READINESS_SKILL), mergeReadinessDir);
    checks.push(
      skill.missing.length
        ? status('warn', 'merge-readiness skill', `missing: ${list(skill.missing)}; rerun node install.mjs --with-merge-readiness`)
        : skill.modified.length
          ? status('warn', 'merge-readiness skill', `customized locally, no longer this repo's: ${list(skill.modified)}`)
          : status('pass', 'merge-readiness skill', 'skill and its workflow script are installed and match this repo')
    );
  }

  return checks;
}

export function summarize(checks) {
  return {
    pass: checks.filter((c) => c.level === 'pass').length,
    warn: checks.filter((c) => c.level === 'warn').length,
    fail: checks.filter((c) => c.level === 'fail').length,
  };
}

function print(checks, json) {
  const summary = summarize(checks);
  if (json) {
    console.log(JSON.stringify({ summary, checks }, null, 2));
    return;
  }
  for (const check of checks) console.log(`[${check.level.toUpperCase()}] ${check.name} — ${check.detail}`);
  console.log(`\nSummary: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail`);
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const flags = process.argv.slice(2);
  const unknown = flags.filter((f) => !['--json', '--help', '-h'].includes(f));
  if (unknown.length) {
    console.error(`unknown flag: ${list(unknown)}\n\n${USAGE}`);
    process.exit(2);
  }
  if (flags.includes('--help') || flags.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }
  const checks = runChecks();
  print(checks, flags.includes('--json'));
  process.exit(summarize(checks).fail > 0 ? 1 : 0);
}
