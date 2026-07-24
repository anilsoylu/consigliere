#!/usr/bin/env node
// PreToolUse(Edit|Write|MultiEdit): block SOURCE-CODE writes until the codex:rescue advisor
// was called for this task. Exempt so meta-work and notes never get locked:
//   - harness/config dirs (~/.claude, ~/.codex)
//   - scratch dirs (/tmp, ~/Desktop)
//   - any non-code file (md/txt/json/toml/yaml/notes/etc.)
// Exit 2 = block, stderr is fed back to the model.
import fs from 'node:fs';
let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
const path = payload.tool_input?.file_path || '';
const sid = payload.session_id || 'default';

// Exempt paths: harness/config + scratch → advisor never required here.
if (/\/\.claude\/|\/\.codex\/|(^|\/)tmp\/|\/Desktop\//.test(path)) process.exit(0);
// Only real source code triggers the gate; md/txt/json/toml/yaml and everything else is free.
const isCode = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|c|h|cpp|hpp|cc|vue|svelte|sql|sh)$/i.test(path);
if (!isCode) process.exit(0);

if (fs.existsSync(`/tmp/advisor-gate-${sid}.flag`)) process.exit(0);
process.stderr.write(
  "ADVISOR GATE (source code): Get a plan from the advisor first by running\n" +
  "  bash ~/.claude/hooks/advisor-watchdog.sh \"<task>. Do NOT web-search; mark external needs as 'RESEARCH NEEDED: <q>'.\"\n" +
  "then relay the plan to the user before writing code. This is the only advisor entry point — " +
  "do not spawn a subagent for it. Details: ~/.claude/rules/advisor-executor.md\n" +
  "If this is genuinely trivial, STOP and ask the user for an explicit go-ahead."
);
process.exit(2);
