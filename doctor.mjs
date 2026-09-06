#!/usr/bin/env node
// Read-only Consigliere installation diagnostics. Reads files, writes none.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { STATE_FILE, HOOK_FILES, AGENT_FILES, DEFAULT_RULES, WORKFLOW_RULE, HOOK_ENTRIES, HANDOFF_SKILLS, GRILLING_SKILLS, GRILLING_FILES, OPTIMIZE_SKILLS, MERGE_READINESS_SKILL, MERGE_READINESS_FILES, UPGRADE_SKILL, UPGRADE_FILES, YAGNI_SKILL, YAGNI_FILES, IMPLEMENT_SKILL, IMPLEMENT_FILES, WIZARD_SKILL, WIZARD_FILES, DEBUGGING_SKILL, DEBUGGING_FILES, SHADCN_SKILL, SHADCN_FILES, RELEASE_PERMISSIONS, RECOMMENDED_ENV, RECOMMENDED_SETTINGS, claudeDir as resolveClaudeDir, hookCommand, hasRalphLoop } from './manifest.mjs';

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

export function runChecks(options = {}) {
  const repo = options.repo || REPO;
  // An explicit home points at a fixture; letting the ambient env win there would make
  // every test read the real install on a machine that sets CLAUDE_CONFIG_DIR.
  const home = options.home || os.homedir();
  const claudeDir = options.claudeDir || (options.home ? path.join(options.home, '.claude') : resolveClaudeDir());
  const hooksDir = path.join(claudeDir, 'hooks');
  const rulesDir = path.join(claudeDir, 'rules');
  const agentsDir = path.join(claudeDir, 'agents');
  const skillsDir = path.join(claudeDir, 'skills');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const checks = [];

  const missingRepoAssets = [
    ...HOOK_FILES.map((f) => path.join(repo, 'hooks', f)),
    ...AGENT_FILES.map((f) => path.join(repo, 'agents', f)),
    ...DEFAULT_RULES.map((f) => path.join(repo, 'rules', f)),
    path.join(repo, 'install.mjs'),
    path.join(repo, 'uninstall.mjs'),
  ].filter((file) => !exists(file));

  checks.push(
    missingRepoAssets.length === 0
      ? status('pass', 'repo assets', 'required agent, hook, rule, install, and uninstall files are present')
      // Forward slashes even on Windows: this names a file in the repo, which is how the
      // README, the rules and every other message here spell it.
      : status('fail', 'repo assets', `missing: ${list(missingRepoAssets.map((f) => path.relative(repo, f).replace(/\\/g, '/')))}`)
  );

  checks.push(
    exists(claudeDir)
      ? status('pass', 'claude directory', `${claudeDir} exists`)
      : status('warn', 'claude directory', `${claudeDir} does not exist yet; run Claude Code before or after install`)
  );

  // The gate blocks the root's source edits and names these roles as the way through.
  // Missing, it is a lock with no key — the loudest thing an otherwise-complete install
  // can get wrong.
  const agents = compare(AGENT_FILES, path.join(repo, 'agents'), agentsDir);
  checks.push(
    agents.missing.length
      ? status('warn', 'agents', `missing: ${list(agents.missing)}; orchestrator-gate.mjs will block the root's source edits naming subagents that do not exist — rerun node install.mjs`)
      : agents.modified.length
        ? status('warn', 'agents', `customized locally, no longer this repo's: ${list(agents.modified)}`)
        : status('pass', 'agents', 'the five subagents are installed and match this repo')
  );

  const hooks = compare(HOOK_FILES, path.join(repo, 'hooks'), hooksDir);
  checks.push(
    hooks.missing.length
      ? status('warn', 'installed hooks', `missing: ${list(hooks.missing)}; rerun node install.mjs`)
      : hooks.modified.length
        ? status('warn', 'installed hooks', `differ from this repo: ${list(hooks.modified)}; rerun node install.mjs to restore`)
        : status('pass', 'installed hooks', 'all orchestrator hooks are installed and match this repo')
  );

  // Editing a rule is legitimate — the uninstaller keeps those — but a pass has to mean verified.
  const rules = compare(DEFAULT_RULES, path.join(repo, 'rules'), rulesDir);
  checks.push(
    rules.missing.length
      ? status('warn', 'installed rules', `missing: ${list(rules.missing)}; rerun node install.mjs`)
      : rules.modified.length
        ? status('warn', 'installed rules', `customized locally, no longer this repo's: ${list(rules.modified)}`)
        : status('pass', 'installed rules', 'the default rules are installed and match this repo')
  );

  const upgrade = compare(UPGRADE_FILES, path.join(repo, 'skills', UPGRADE_SKILL), path.join(skillsDir, UPGRADE_SKILL));
  checks.push(
    upgrade.missing.length
      ? status('warn', 'upgrade skill', `not installed (${list(upgrade.missing)}); rerun node install.mjs to restore, or ignore this if you removed it on purpose`)
      : upgrade.modified.length
        ? status('warn', 'upgrade skill', `customized locally, no longer this repo's: ${list(upgrade.modified)}`)
        : status('pass', 'upgrade skill', `the /${UPGRADE_SKILL} command is installed and matches this repo`)
  );

  // Default skill, so unlike merge-readiness its absence is a finding, not a skip.
  const yagni = compare(YAGNI_FILES, path.join(repo, 'skills', YAGNI_SKILL), path.join(skillsDir, YAGNI_SKILL));
  checks.push(
    yagni.missing.length
      ? status('warn', 'yagni skill', `not installed (${list(yagni.missing)}); rerun node install.mjs to restore, or ignore this if you removed it on purpose`)
      : yagni.modified.length
        ? status('warn', 'yagni skill', `customized locally, no longer this repo's: ${list(yagni.modified)}`)
        : status('pass', 'yagni skill', 'the yagni deletion pass is installed and matches this repo')
  );

  // Default like yagni, and the pair is one feature: SKILL.md tells the root to pass the
  // script beside it, so either half alone is a dangling reference.
  const implement = compare(IMPLEMENT_FILES, path.join(repo, 'skills', IMPLEMENT_SKILL), path.join(skillsDir, IMPLEMENT_SKILL));
  checks.push(
    implement.missing.length
      ? status('warn', 'implement-review-verify skill', `not installed (${list(implement.missing)}); rerun node install.mjs to restore, or ignore this if you removed it on purpose`)
      : implement.modified.length
        ? status('warn', 'implement-review-verify skill', `customized locally, no longer this repo's: ${list(implement.modified)}`)
        : status('pass', 'implement-review-verify skill', 'the implement/review/verify workflow and its script are installed and match this repo')
  );

  // Default like yagni: a prompt file with no runtime cost, inert until it is invoked.
  const grilling = { missing: [], modified: [] };
  for (const skill of GRILLING_SKILLS) {
    const r = compare(GRILLING_FILES, path.join(repo, 'skills', skill), path.join(skillsDir, skill));
    grilling.missing.push(...r.missing.map((f) => `${skill}/${f}`));
    grilling.modified.push(...r.modified.map((f) => `${skill}/${f}`));
  }
  checks.push(
    grilling.missing.length
      ? status('warn', 'grilling skills', `not installed (${list(grilling.missing)}); rerun node install.mjs to restore, or ignore this if you removed it on purpose`)
      : grilling.modified.length
        ? status('warn', 'grilling skills', `customized locally, no longer this repo's: ${list(grilling.modified)}`)
        : status('pass', 'grilling skills', 'the grilling interview and its /grill-me wrapper are installed and match this repo')
  );

  // Default, and model-invoked like shadcn: a missing one fails silently in use, because
  // Claude just debugs by guesswork instead of reporting the skill it could not load.
  const debugging = compare(DEBUGGING_FILES, path.join(repo, 'skills', DEBUGGING_SKILL), path.join(skillsDir, DEBUGGING_SKILL));
  checks.push(
    debugging.missing.length
      ? status('warn', 'systematic-debugging skill', `not installed (${list(debugging.missing)}); rerun node install.mjs to restore, or ignore this if you removed it on purpose`)
      : debugging.modified.length
        ? status('warn', 'systematic-debugging skill', `customized locally, no longer this repo's: ${list(debugging.modified)}`)
        : status('pass', 'systematic-debugging skill', 'the debugging process and its techniques are installed and match this repo')
  );

  // Default like yagni. template.sh is the library every generated wizard runs on, so a
  // modified one silently changes every wizard authored after it.
  const wizard = compare(WIZARD_FILES, path.join(repo, 'skills', WIZARD_SKILL), path.join(skillsDir, WIZARD_SKILL));
  checks.push(
    wizard.missing.length
      ? status('warn', 'wizard skill', `not installed (${list(wizard.missing)}); rerun node install.mjs to restore, or ignore this if you removed it on purpose`)
      : wizard.modified.length
        ? status('warn', 'wizard skill', `customized locally, no longer this repo's: ${list(wizard.modified)}`)
        : status('pass', 'wizard skill', 'the wizard generator and its template are installed and match this repo')
  );

  // Also a default skill, and model-invoked rather than a slash command, so a missing
  // one fails silently in use — Claude just writes shadcn code without the rules.
  const shadcn = compare(SHADCN_FILES, path.join(repo, 'skills', SHADCN_SKILL), path.join(skillsDir, SHADCN_SKILL));
  checks.push(
    shadcn.missing.length
      ? status('warn', 'shadcn skill', `not installed (${list(shadcn.missing)}); rerun node install.mjs to restore, or ignore this if you removed it on purpose`)
      : shadcn.modified.length
        ? status('warn', 'shadcn skill', `customized locally, no longer this repo's: ${list(shadcn.modified)}`)
        : status('pass', 'shadcn skill', 'the shadcn skill is installed and matches this repo')
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
          : status('pass', 'settings hooks', 'all orchestrator hook entries are registered as installed')
      );
    }
  }

  // A recommended key you set to a value of your own is not a finding — the installer
  // never overwrites one, and neither does this. Only absence is reported.
  if (isObject(settings)) {
    const absent = [
      // `in` throws on a primitive, and a diagnostic tool that crashes on the broken
      // settings.json it exists to diagnose is worse than one that reports the keys missing
      ...Object.keys(RECOMMENDED_ENV).filter((k) => !(k in (isObject(settings.env) ? settings.env : {}))).map((k) => `env.${k}`),
      ...Object.keys(RECOMMENDED_SETTINGS).filter((k) => !(k in settings)),
    ];
    checks.push(
      absent.length
        ? status('warn', 'recommended settings', `no value set for: ${list(absent)}; rerun node install.mjs to fill them in`)
        : status('pass', 'recommended settings', 'every recommended env key and setting has a value')
    );
  }

  // settings.env wins because Claude Code writes it over the shell, which makes `"KEY": ""`
  // the way to unset an export; the shell fills the rest, where FORCE normally lives.
  const shellEnv = options.env ?? process.env;
  const cfg = isObject(settings) ? settings : {};
  const settingsEnv = isObject(cfg.env) ? cfg.env : {};
  const value = (k) => settingsEnv[k] ?? shellEnv[k];
  // "0" must not read as disabled — that silences the warning in the case it exists for.
  const truthy = (key) => /^(1|true|yes|on)$/i.test(value(key) || '');
  const advisorToolOff = truthy('CLAUDE_CODE_DISABLE_ADVISOR_TOOL');
  const rootProblems = [];
  if (cfg.model !== RECOMMENDED_SETTINGS.model) {
    rootProblems.push(`model is ${cfg.model ? `"${cfg.model}"` : 'unset'}, but the root only decides and delegates, which is worth doing at ${RECOMMENDED_SETTINGS.model}. Set it in settings.json or with /model`);
  }
  if (value('CLAUDE_CODE_EFFORT_LEVEL')) {
    rootProblems.push('CLAUDE_CODE_EFFORT_LEVEL applies to every model at once and overrides the effort: line in each agent file. Unset it and use /effort for the root');
  }
  for (const key of ['CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE']) {
    if (value(key)) rootProblems.push(`${key} is set and overrides the model: line in every agent file. Unset it`);
  }
  if (truthy('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')) {
    rootProblems.push('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS makes a named subagent a teammate: its agent file is appended to the default system prompt instead of replacing it, and it inherits the root\'s effort. The reviewer\'s fresh context and the per-role effort: lines both depend on the flag being off. Unset it, or set it to "" in settings.env');
  }
  if (cfg.advisorModel && !advisorToolOff) {
    rootProblems.push(`advisorModel is "${cfg.advisorModel}", so Claude Code's built-in advisor tool runs alongside this topology: each consult is paid twice and it re-reads the whole transcript uncached on every call. Run /advisor off, or set CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`);
  }
  checks.push(
    rootProblems.length
      ? status('warn', 'root model', rootProblems.join('; '))
      : status('pass', 'root model', 'the root runs the recommended model and nothing overrides the agents\' model or effort')
  );

  // --with-workflow ships the rule with every skill it names; one without the others
  // leaves a dangling reference, so they are one check rather than five
  const workflowRule = path.join(rulesDir, WORKFLOW_RULE);
  const workflowSkills = ['ralph-protocol', ...HANDOFF_SKILLS, ...OPTIMIZE_SKILLS];
  const skillFile = (root, skill) => path.join(root, skill, 'SKILL.md');
  if (exists(workflowRule) || workflowSkills.some((s) => exists(skillFile(skillsDir, s)))) {
    const absent = [
      ...(exists(workflowRule) ? [] : [WORKFLOW_RULE]),
      ...workflowSkills.filter((s) => !exists(skillFile(skillsDir, s))).map((s) => `${s}/SKILL.md`),
    ];
    const drifted = [
      ...compare([WORKFLOW_RULE], path.join(repo, 'rules'), rulesDir).modified,
      ...workflowSkills
        .filter((s) => exists(skillFile(skillsDir, s)) && !sameBytes(skillFile(path.join(repo, 'skills'), s), skillFile(skillsDir, s)))
        .map((s) => `${s}/SKILL.md`),
    ];
    checks.push(
      absent.length
        ? status('warn', 'workflow assets', `the workflow rule and the skills it names install together; missing: ${list(absent)} — rerun node install.mjs --with-workflow`)
        : drifted.length
          ? status('warn', 'workflow assets', `customized locally, no longer this repo's: ${list(drifted)}`)
          : status('pass', 'workflow assets', 'the workflow rule and every skill it names are installed and match this repo')
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

  // The same comparison update-check.mjs makes, for anyone who does not want the hook — or
  // cannot have it, since it stands down under CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC.
  // Blocking is fine in a CLI, so this one asks upstream directly instead of a cache.
  let state = {};
  try { state = JSON.parse(fs.readFileSync(path.join(claudeDir, STATE_FILE), 'utf8')); } catch {}
  const installed = state.version || null;
  const latest = installed ? latestTag(repo) : null;
  checks.push(
    !installed
      ? status('warn', 'version', `no version recorded in ${path.join(claudeDir, STATE_FILE)}; rerun node install.mjs`)
      : !latest
        ? status('pass', 'version', `${installed} installed; this clone's origin was unreachable, so nothing to compare`)
        : compareTags(latest, installed) > 0
          ? status('warn', 'version', `${latest} is out, ${installed} installed — cd ${repo} && git pull && node install.mjs`)
          : status('pass', 'version', `${installed} installed, up to date with ${repo}`)
  );

  // Only for someone who asked the installer for them, and only when one is gone: the list
  // is yours to edit once written, so a complete one is not worth a line of output. An absent
  // or unparseable settings.json is already its own check, so it reports no rule as missing.
  if (isObject(settings) && (state.flags || []).includes('--with-release-permissions')) {
    const perms = cfg.permissions;
    // The installer skips a block of another shape, so reporting the rules as missing would
    // send you to a rerun that cannot add them.
    const badShape = perms !== undefined && !isObject(perms)
      ? 'settings.permissions is not an object'
      : isObject(perms) && perms.allow !== undefined && !Array.isArray(perms.allow)
        ? 'settings.permissions.allow is not an array'
        : null;
    const allow = Array.isArray(perms?.allow) ? perms.allow : [];
    const absent = RELEASE_PERMISSIONS.filter((rule) => !allow.includes(rule));
    if (badShape) checks.push(status('warn', 'release permissions', `${badShape}, so the installer leaves it alone; fix the shape by hand, then rerun node install.mjs --with-release-permissions`));
    else if (absent.length) checks.push(status('warn', 'release permissions', `missing from settings.permissions.allow: ${list(absent)}; an unattended release stalls on the first denied command, so rerun node install.mjs --with-release-permissions`));
  }

  // Reported, never repaired: the old tree may hold hooks and skills of your own, and
  // this command writes nothing. Left alone it is only confusing, not harmful.
  const legacy = path.join(home, '.claude');
  if (path.resolve(legacy) !== path.resolve(claudeDir) && exists(path.join(legacy, STATE_FILE))) {
    checks.push(status('warn', 'stale install', `CLAUDE_CONFIG_DIR points at ${claudeDir}, but an earlier install is still in ${legacy}; Claude Code no longer reads it — remove it by hand once the new one checks out`));
  }

  return checks;
}

// Only N.N.N sorts: the repo carries a `v1-sol` tag from an older era that must not win.
// The `v` is optional because tags carry it and the recorded VERSION does not.
const parseTag = (tag) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag)?.slice(1).map(Number);
export function compareTags(a, b) {
  const [x, y] = [parseTag(a), parseTag(b)];
  if (!x || !y) return 0;
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

function latestTag(repo) {
  try {
    const out = execFileSync('git', ['ls-remote', '--tags', 'origin'], {
      cwd: repo, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const tags = out.split('\n').map((l) => l.split('refs/tags/')[1]).filter((t) => t && parseTag(t)).sort(compareTags);
    return tags.at(-1) || null;
  } catch { return null; }
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
