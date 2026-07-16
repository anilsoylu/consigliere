#!/usr/bin/env node
// Marks the advisor gate flag when the advisor is invoked — via EITHER the codex:rescue
// subagent (Task) OR the watchdog/companion Bash call. Always exits 0 (never blocks).
import fs from 'node:fs';
let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
const ti = payload.tool_input || {};
const isAdvisor =
  /advisor|codex/i.test(ti.subagent_type || '') ||
  /advisor-watchdog\.sh|codex-companion\.mjs\s+task/i.test(ti.command || '');
if (isAdvisor) {
  const sid = payload.session_id || 'default';
  try { fs.writeFileSync(`/tmp/advisor-gate-${sid}.flag`, '1'); } catch {}
}
