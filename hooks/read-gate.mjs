#!/usr/bin/env node
// Keeps large files out of the root context. A file the root reads is re-read on every later
// turn and inherited by every fork; a `reader` subagent answers the question instead.
// Cost guard, not a safety guard, so it fails open where orchestrator-gate fails closed.
import fs from 'node:fs';
import path from 'node:path';
import { cfgDir } from './config-dir.mjs';

const MAX = Number(process.env.READ_GATE_MAX_LINES) || 350;

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `${reason} Delegate to \`reader\` with the question you need answered, `
        + `or pass offset/limit for a range you already know. Limit: ${MAX} lines (READ_GATE_MAX_LINES).`,
    },
  }));
  process.exit(0);
}

if (!fs.existsSync(path.join(cfgDir(), 'rules', 'orchestrator.md'))) process.exit(0);

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
if (typeof payload.agent_id === 'string' && payload.agent_id) process.exit(0);

function lines(file) {
  try {
    if (!fs.statSync(file).isFile()) return 0;
    return fs.readFileSync(file, 'utf8').split('\n').length;
  } catch { return 0; }
}

if (payload.tool_name === 'Read') {
  const { file_path: file = '', limit } = payload.tool_input || {};
  if (!file || limit || /\.(png|jpe?g|gif|webp|pdf|ipynb)$/i.test(file)) process.exit(0);
  const n = lines(file);
  if (n > MAX) deny(`${path.basename(file)} has ${n} lines.`);
  process.exit(0);
}

if (payload.tool_name !== 'Bash') process.exit(0);
const cwd = payload.cwd || '.';
// No quote masking: a false split yields a path that does not exist, which passes.
for (const seg of (payload.tool_input?.command || '').split(/;|&&|\|\||\||&|\r|\n/)) {
  const argv = seg.trim().split(/\s+/).filter(Boolean);
  const root = path.basename(argv[0] || '');
  if (!/^(cat|less|more|head|tail)$/.test(root)) continue;
  if (/^(head|tail)$/.test(root)) {
    const bound = argv.slice(1).map((a, i, arr) => {
      const m = a.match(/^-(?:n|c)(?:=?(\d+))?$|^-(\d+)$|^--(?:lines|bytes)=(\d+)$/);
      return m ? Number(m[1] ?? m[2] ?? m[3] ?? arr[i + 1]) : NaN;
    }).find((b) => !Number.isNaN(b));
    if (bound !== undefined && bound <= MAX) continue;
  }
  for (const arg of argv.slice(1).filter((a) => !a.startsWith('-'))) {
    const n = lines(path.resolve(cwd, arg));
    if (n > MAX) deny(`\`${root} ${arg}\` would read ${n} lines.`);
  }
}
