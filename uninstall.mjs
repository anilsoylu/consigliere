#!/usr/bin/env node
// Consigliere uninstaller — removes the hooks + rules and strips ONLY the consigliere
// hook entries from settings.json, leaving your other hooks untouched. Backs up
// settings.json before editing. Your .consigliere.bak files are left in place.
// A rule is only deleted when it is still byte-identical to this repo's copy, so a
// file you wrote or edited yourself is never silently removed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOOK_FILES, DEFAULT_RULES, WORKFLOW_RULE, MERGE_READINESS_SKILL, MERGE_READINESS_FILES } from './manifest.mjs';

const HOME = os.homedir();
const REPO = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE = path.join(HOME, '.claude');
const HOOKS = path.join(CLAUDE, 'hooks');
const RULES = path.join(CLAUDE, 'rules');
const SETTINGS = path.join(CLAUDE, 'settings.json');

const log = (...a) => console.log('[consigliere]', ...a);
const ADVISOR = HOOK_FILES;
const RULE_FILES = [...DEFAULT_RULES, WORKFLOW_RULE];

// --- 1. Remove hook files ---
for (const f of ADVISOR) {
  const p = path.join(HOOKS, f);
  if (fs.existsSync(p)) { fs.rmSync(p); log(`removed ${f}`); }
}

// --- 1b. Remove rules, but only the untouched ones this installer placed ---
for (const f of RULE_FILES) {
  const installed = path.join(RULES, f);
  const source = path.join(REPO, 'rules', f);
  if (!fs.existsSync(installed)) continue;
  if (!fs.existsSync(source)) { log(`kept ${f} — no repo copy to compare it against`); continue; }
  if (fs.readFileSync(installed).equals(fs.readFileSync(source))) { fs.rmSync(installed); log(`removed ${f}`); }
  else log(`kept ${f} — it differs from this repo's copy, so it is yours to delete`);
}

// --- 1c. Remove the ralph-protocol skill, same untouched-only rule ---
{
  const installed = path.join(CLAUDE, 'skills', 'ralph-protocol', 'SKILL.md');
  const source = path.join(REPO, 'skills', 'ralph-protocol', 'SKILL.md');
  if (fs.existsSync(installed) && fs.existsSync(source)) {
    if (fs.readFileSync(installed).equals(fs.readFileSync(source))) {
      fs.rmSync(installed);
      try { fs.rmdirSync(path.dirname(installed)); } catch {} // only when it is now empty
      log('removed skills/ralph-protocol');
    } else log("kept skills/ralph-protocol — it differs from this repo's copy, so it is yours to delete");
  }
}

// --- 1d. Remove the merge-readiness skill and its workflow script, same rule ---
{
  const destDir = path.join(CLAUDE, 'skills', MERGE_READINESS_SKILL);
  const srcDir = path.join(REPO, 'skills', MERGE_READINESS_SKILL);
  for (const f of MERGE_READINESS_FILES) {
    const installed = path.join(destDir, f);
    const source = path.join(srcDir, f);
    if (!fs.existsSync(installed) || !fs.existsSync(source)) continue;
    if (fs.readFileSync(installed).equals(fs.readFileSync(source))) { fs.rmSync(installed); log(`removed ${MERGE_READINESS_SKILL}/${f}`); }
    else log(`kept ${MERGE_READINESS_SKILL}/${f} — it differs from this repo's copy, so it is yours to delete`);
  }
  try { fs.rmdirSync(destDir); } catch {} // only when it is now empty
}

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
}

log('done. web_search="disabled" in ~/.codex/config.toml was left as-is — remove it by hand if you want Codex web search back (a .consigliere.bak is next to it).');
