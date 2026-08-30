#!/usr/bin/env node
// PostToolUse(Edit|Write|MultiEdit): nudge when an edit lands more comment than code.
// rules/coding-discipline.md defaults comments to none, and the prose alone did not
// hold. PostToolUse cannot block — it injects context asking for a follow-up trim
// while the diff is still hot, which is the moment a comment is cheapest to delete.
//
// Only line-leading comments are counted. Trailing comments, docstrings and strings
// that merely look like comments stay uncounted on purpose: undercounting keeps the
// nudge silent in ambiguous cases, and staying rare is what keeps a nudge heard.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function cfgDir() {
  const e = process.env.CLAUDE_CONFIG_DIR;
  if (e && e.trim() !== '') {
    return e.startsWith('~') ? path.resolve(os.homedir(), e.replace(/^~[/\\]?/, '')) : path.resolve(e);
  }
  return path.join(os.homedir(), '.claude');
}

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
if (!fs.existsSync(path.join(cfgDir(), 'rules', 'coding-discipline.md'))) process.exit(0);

const file = String(payload.tool_input?.file_path || '');
const t = payload.tool_input || {};
const content = typeof t.content === 'string' ? t.content
  : typeof t.new_string === 'string' ? t.new_string
  : Array.isArray(t.edits) ? t.edits.map((e) => e?.new_string || '').join('\n')
  : '';
if (!content) process.exit(0);

// The shebang test keeps `#!/usr/bin/env node` out of the hash count, and the
// `*(?:\s|\/|$)` shape keeps C-family `*p = x;` dereferences out of the star count.
let marker = null;
if (/\.(py|rb|sh)$/i.test(file)) marker = /^\s*#(?!!)/;
else if (/\.(ts|tsx|js|jsx|mjs|cjs|go|rs|c|h|cpp|hpp|cc|java|kt|swift|php|vue|svelte)$/i.test(file)) marker = /^\s*(\/\/|\/\*|\*(?:\s|\/|$)|<!--)/;
else if (/\.sql$/i.test(file)) marker = /^\s*--/;
if (!marker) process.exit(0);

let comment = 0;
let code = 0;
for (const line of content.split('\n')) {
  if (!line.trim()) continue;
  if (marker.test(line)) comment += 1;
  else code += 1;
}
// The size floor keeps a deliberate 3-line comment insert (0 code) below the radar.
if (comment < 3 || comment < code || comment + code < 5) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext:
      `COMMENT BUDGET: this edit landed ${comment} comment lines against ${code} lines of code. `
      + 'rules/coding-discipline.md defaults to none — a comment earns its line only by saying why: '
      + 'the constraint, the rejected alternative, the bug it prevents. '
      + 'Re-edit the same span now and delete every comment that restates the code.',
  },
}));
