#!/usr/bin/env node
// PreToolUse(Edit|Write|MultiEdit): block SOURCE-CODE writes until the advisor subagent
// was called for this task. Exempt so meta-work and notes never get locked:
//   - the harness config dir (~/.claude)
//   - scratch dirs (/tmp, ~/Desktop)
//   - any non-code file (md/txt/json/toml/yaml/notes/etc.)
// The decision goes out as JSON rather than exit 2 — same block, no red hook error in
// the transcript. Exit 0 with no output = no decision.
//
// There was once a second guard here: a scope check that pushed writes outside the
// session's cwd to a permission prompt. In a monorepo it counted sibling packages/* as
// outside and prompted on every one, which overrides auto mode and strands unattended
// runs. Removed on purpose — the boundary lives in rules/workflow.md as a rule instead.
import fs from 'node:fs';
let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
const path = payload.tool_input?.file_path || '';
const sid = payload.session_id || 'default';

// Exempt paths: harness/config + scratch → advisor never required here.
if (/\/\.claude\/|(^|\/)tmp\/|\/Desktop\//.test(path)) process.exit(0);
// Only real source code triggers the gate; md/txt/json/toml/yaml and everything else is free.
const isCode = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|c|h|cpp|hpp|cc|vue|svelte|sql|sh)$/i.test(path);
if (!isCode) process.exit(0);

if (fs.existsSync(`/tmp/advisor-gate-${sid}.flag`)) process.exit(0);
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'ADVISOR GATE: plan first — Agent({ subagent_type: "advisor", prompt: "<consult>" }), then relay the plan before writing code. See ~/.claude/rules/advisor-executor.md.\n' +
      'Genuinely trivial? Stop and ask the user for an explicit go-ahead.',
  },
}));
