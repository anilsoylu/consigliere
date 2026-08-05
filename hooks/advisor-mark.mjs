#!/usr/bin/env node
// Marks the advisor gate flag when the advisor subagent is invoked (Task).
// Always exits 0 (never blocks).
import fs from 'node:fs';
let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
const ti = payload.tool_input || {};
if (/advisor/i.test(ti.subagent_type || '')) {
  const sid = payload.session_id || 'default';
  try { fs.writeFileSync(`/tmp/advisor-gate-${sid}.flag`, '1'); } catch {}
}
