#!/usr/bin/env node
// Consigliere uninstaller — removes the agent, hooks and rules it placed, and strips ONLY
// the consigliere hook entries from settings.json, leaving your other hooks untouched.
// Backs up settings.json before editing. Your .consigliere.bak files are left in place.
// A file is only deleted when it is still byte-identical to this repo's copy, so anything
// you wrote or edited yourself is never silently removed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { STATE_FILE, HOOK_FILES, OBSOLETE_HOOK_FILES, AGENT_FILES, DEFAULT_RULES, WORKFLOW_RULE, HANDOFF_SKILLS, HANDOFF_FILES, GRILLING_SKILLS, GRILLING_FILES, OPTIMIZE_SKILLS, OPTIMIZE_FILES, MERGE_READINESS_SKILL, MERGE_READINESS_FILES, YAGNI_SKILL, YAGNI_FILES, WIZARD_SKILL, WIZARD_FILES, DEBUGGING_SKILL, DEBUGGING_FILES, SHADCN_SKILL, SHADCN_FILES } from './manifest.mjs';

const HOME = os.homedir();
const REPO = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE = path.join(HOME, '.claude');
const HOOKS = path.join(CLAUDE, 'hooks');
const RULES = path.join(CLAUDE, 'rules');
const AGENTS = path.join(CLAUDE, 'agents');
const SKILLS = path.join(CLAUDE, 'skills');
const SETTINGS = path.join(CLAUDE, 'settings.json');

const log = (...a) => console.log('[consigliere]', ...a);
const ADVISOR = HOOK_FILES;
const RULE_FILES = [...DEFAULT_RULES, WORKFLOW_RULE];

// A file you edited is yours. For a hook, its settings.json entry still goes in step 2,
// so the file is left in place but no longer wired up. prune drops the directory when
// this leaves it empty — rmdir fails harmlessly when anything of yours is still in it.
function removeUntouched(files, srcDir, destDir, { prune = false } = {}) {
  const where = path.basename(destDir);
  for (const f of files) {
    const installed = path.join(destDir, f);
    const source = path.join(srcDir, f);
    if (!fs.existsSync(installed)) continue;
    if (!fs.existsSync(source)) { log(`kept ${where}/${f} — no repo copy to compare it against`); continue; }
    if (fs.readFileSync(installed).equals(fs.readFileSync(source))) { fs.rmSync(installed); log(`removed ${where}/${f}`); }
    else log(`kept ${where}/${f} — it differs from this repo's copy, so it is yours to delete`);
  }
  // deepest first, so a skill laid out in subdirectories collapses from the leaves up
  if (prune) {
    const dirs = [...new Set(files.map((f) => path.dirname(path.join(destDir, f))))].sort((a, b) => b.length - a.length);
    for (const dir of [...dirs, destDir]) { try { fs.rmdirSync(dir); } catch {} }
  }
}

// --- 1. Remove the files this installer placed, untouched ones only ---
// No prune for agents: ~/.claude/agents is the harness's directory, not one this
// package created, so it stays even when removing advisor.md leaves it empty.
removeUntouched(AGENT_FILES, path.join(REPO, 'agents'), AGENTS);
removeUntouched(ADVISOR, path.join(REPO, 'hooks'), HOOKS);
removeUntouched(RULE_FILES, path.join(REPO, 'rules'), RULES);
removeUntouched(['SKILL.md'], path.join(REPO, 'skills', 'ralph-protocol'), path.join(SKILLS, 'ralph-protocol'), { prune: true });
for (const skill of HANDOFF_SKILLS) removeUntouched(HANDOFF_FILES, path.join(REPO, 'skills', skill), path.join(SKILLS, skill), { prune: true });
for (const skill of OPTIMIZE_SKILLS) removeUntouched(OPTIMIZE_FILES, path.join(REPO, 'skills', skill), path.join(SKILLS, skill), { prune: true });
for (const skill of GRILLING_SKILLS) removeUntouched(GRILLING_FILES, path.join(REPO, 'skills', skill), path.join(SKILLS, skill), { prune: true });
removeUntouched(MERGE_READINESS_FILES, path.join(REPO, 'skills', MERGE_READINESS_SKILL), path.join(SKILLS, MERGE_READINESS_SKILL), { prune: true });
removeUntouched(YAGNI_FILES, path.join(REPO, 'skills', YAGNI_SKILL), path.join(SKILLS, YAGNI_SKILL), { prune: true });
removeUntouched(WIZARD_FILES, path.join(REPO, 'skills', WIZARD_SKILL), path.join(SKILLS, WIZARD_SKILL), { prune: true });
removeUntouched(DEBUGGING_FILES, path.join(REPO, 'skills', DEBUGGING_SKILL), path.join(SKILLS, DEBUGGING_SKILL), { prune: true });
removeUntouched(SHADCN_FILES, path.join(REPO, 'skills', SHADCN_SKILL), path.join(SKILLS, SHADCN_SKILL), { prune: true });

// Left by a version before this one. There is no repo copy left to compare against, so
// the keep-what-you-edited rule cannot apply — an upgrade would have deleted it anyway.
for (const f of OBSOLETE_HOOK_FILES) {
  const stale = path.join(HOOKS, f);
  if (fs.existsSync(stale)) { fs.rmSync(stale); log(`removed hooks/${f} — shipped by an earlier version`); }
}

// Machine state, not a file anyone edits, so the byte-identical rule does not apply.
// Left behind it would claim a version is installed when nothing is.
const statePath = path.join(CLAUDE, STATE_FILE);
if (fs.existsSync(statePath)) { fs.rmSync(statePath, { force: true }); log(`removed ~/.claude/${STATE_FILE}`); }

// --- 2. Strip consigliere hook entries from settings.json (keep the rest) ---
if (fs.existsSync(SETTINGS)) {
  const bak = `${SETTINGS}.consigliere-uninstall.bak`;
  if (!fs.existsSync(bak)) fs.copyFileSync(SETTINGS, bak);
  let s;
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); }
  catch { log('settings.json is not valid JSON; left it alone.'); process.exit(0); }
  const isAdvisor = (cmd) => ADVISOR.some((a) => (cmd || '').includes(a));
  for (const event of Object.keys(s.hooks || {})) {
    s.hooks[event] = (s.hooks[event] || [])
      .map((block) => ({ ...block, hooks: (block.hooks || []).filter((h) => !isAdvisor(h.command)) }))
      .filter((block) => (block.hooks || []).length > 0);
    if (s.hooks[event].length === 0) delete s.hooks[event];
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
  log('stripped consigliere hook entries from settings.json (your other hooks kept)');
  // The recommended env keys and the context-mode plugin entry are not reverted. Once
  // written they read as your settings, not this package's — an installer that fills a
  // gap has no way to tell later whether you kept the value on purpose.
  log('left your env keys, other settings and any plugins alone; the backup above predates this run');
}

log('done. Restart Claude Code so the agent, rules and hooks stop loading.');
