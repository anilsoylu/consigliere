#!/usr/bin/env node
// Consigliere uninstaller — removes the hooks + rule and strips ONLY the consigliere
// hook entries from settings.json, leaving your other hooks untouched. Backs up
// settings.json before editing. Your .consigliere.bak files are left in place.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const HOOKS = path.join(CLAUDE, 'hooks');
const RULES = path.join(CLAUDE, 'rules');
const SETTINGS = path.join(CLAUDE, 'settings.json');

const log = (...a) => console.log('[consigliere]', ...a);
const ADVISOR = ['advisor-inject.mjs', 'advisor-mark.mjs', 'advisor-gate.mjs', 'advisor-watchdog.sh'];

// --- 1. Remove hook files + rule ---
for (const f of ADVISOR) {
  const p = path.join(HOOKS, f);
  if (fs.existsSync(p)) { fs.rmSync(p); log(`removed ${f}`); }
}
const rule = path.join(RULES, 'advisor-executor.md');
if (fs.existsSync(rule)) { fs.rmSync(rule); log('removed advisor-executor.md'); }

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
