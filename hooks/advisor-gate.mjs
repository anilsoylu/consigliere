#!/usr/bin/env node
// PreToolUse(Edit|Write|MultiEdit): block SOURCE-CODE writes until the advisor subagent
// was called for this task. Exempt so meta-work and notes never get locked:
//   - the harness config dir (~/.claude)
//   - scratch dirs (the OS temp dir, ~/Desktop)
//   - any non-code file (md/txt/json/toml/yaml/notes/etc.)
// The decision goes out as JSON rather than exit 2 — same block, no red hook error in
// the transcript. Exit 0 with no output = no decision.
//
// There was once a second guard here: a scope check that pushed writes outside the
// session's cwd to a permission prompt. In a monorepo it counted sibling packages/* as
// outside and prompted on every one, which overrides auto mode and strands unattended
// runs. Removed on purpose — the boundary lives in rules/workflow.md as a rule instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
// Windows hands over `C:\Users\x\file.ts`. Every path test below is written with forward
// slashes, so normalizing once here is what keeps the exemptions working off macOS.
const file = (payload.tool_input?.file_path || '').replace(/\\/g, '/');
const sid = payload.session_id || 'default';

// Exempt paths: harness/config + scratch → advisor never required here. The literal `tmp/`
// covers POSIX; the prefix test covers the platforms whose temp dir is somewhere else
// entirely (`%LOCALAPPDATA%\Temp`, `/var/folders/...`). Compared case-insensitively because
// Windows hands back the same directory with inconsistent casing.
// The separator is part of the prefix on purpose: a bare one would exempt `/tmpfoo/x.ts`
// on Linux, where the temp dir is `/tmp` — a whole sibling tree through the gate.
const scratch = `${os.tmpdir().replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()}/`;
if (file.toLowerCase().startsWith(scratch) || /\/\.claude\/|(^|\/)tmp\/|\/Desktop\//.test(file)) process.exit(0);
// Only real source code triggers the gate; md/txt/json/toml/yaml and everything else is free.
const isCode = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|c|h|cpp|hpp|cc|vue|svelte|sql|sh)$/i.test(file);
if (!isCode) process.exit(0);

if (fs.existsSync(path.join(os.tmpdir(), `advisor-gate-${sid}.flag`))) process.exit(0);
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    // Phrased as the directive itself, not a complaint. advisor-inject.mjs guesses from the
    // prompt's wording whether a task will end in code; this hook knows, because it holds the
    // path. An unwarned deny is that directive arriving late, so it must say what to do next.
    // It must NOT offer "ask the user" — that branch is what turned a deny into a stall.
    permissionDecisionReason:
      'ADVISOR GATE: no consult has run for this task yet. Call Agent({ subagent_type: "advisor", name: "advisor", prompt: "<consult>" }) '
      + 'with the five-part contract — objective, files, evidence, constraints, options considered. '
      + 'The verdict arrives as a task notification; do work that does not depend on it meanwhile, then retry this exact edit once it lands. '
      + 'The consult is the unblock, so do not stop to ask for a go-ahead — unless this same edit is denied again after a consult, '
      + 'which means the hook is broken rather than unsatisfied: say so and stop. See ~/.claude/rules/advisor-executor.md.',
  },
}));
