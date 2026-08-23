#!/usr/bin/env node
// Marks the advisor gate flag when the advisor is consulted — by Task spawn, or by
// SendMessage to an advisor already spawned in this session. Always exits 0 (never blocks).
//
// The SendMessage half is not a convenience: rules/advisor-executor.md tells the executor
// to spawn one named advisor per task and continue it, so on every task after the first
// the consult IS a SendMessage. Marking only on Task would gate work that was consulted.
// The roster is keyed by session and outlives the per-prompt flag reset, because the
// advisor it names is still alive across those prompts.
import fs from 'node:fs';
let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
const ti = payload.tool_input || {};
const sid = payload.session_id || 'default';
const roster = `/tmp/advisor-agents-${sid}.json`;

const names = (() => {
  try { return JSON.parse(fs.readFileSync(roster, 'utf8')); } catch { return []; }
})();

let consulted = false;
if (/advisor/i.test(ti.subagent_type || '')) {
  consulted = true;
  // Named spawns are addressable later; an unnamed one can only ever be a Task consult.
  if (ti.name && !names.includes(ti.name)) {
    try { fs.writeFileSync(roster, JSON.stringify([...names, ti.name])); } catch {}
  }
} else if (ti.to && (names.includes(ti.to) || /advisor/i.test(ti.to))) {
  consulted = true;
}

if (consulted) {
  try { fs.writeFileSync(`/tmp/advisor-gate-${sid}.flag`, '1'); } catch {}
}
