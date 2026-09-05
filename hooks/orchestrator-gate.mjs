#!/usr/bin/env node
// Restricts the root session to deciding and delegating. agent_id is present only when a
// hook fires inside a subagent, so its absence identifies the orchestrator's own thread —
// which is why this cannot be a permissions.deny rule: those apply to workers too.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cfgDir } from './config-dir.mjs';

const ROUTE = 'Delegate it: `worker` for code and commands, `tester` for verification. '
  + 'This gate keys on the absence of agent_id, so the same call from a subagent passes.';

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `${reason} ${ROUTE}`,
    },
  }));
  process.exit(0);
}

// Deleting the rule this enforces is how you turn the gate off. Checked before the payload is
// read so a disabled gate never denies.
if (!fs.existsSync(path.join(cfgDir(), 'rules', 'orchestrator.md'))) process.exit(0);

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { deny('Root gate could not parse the hook payload.'); }

if (payload.agent_id) process.exit(0);

const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
// The trailing separator is deliberate: a bare prefix would also exempt /tmpfoo/x.ts.
const prefix = (p) => `${norm(p).replace(/\/$/, '')}/`;

if (payload.tool_name !== 'Bash') {
  const file = norm(payload.tool_input?.file_path || '');
  if (!file) process.exit(0);
  const exempt = [os.tmpdir(), cfgDir(), path.join(os.homedir(), 'Desktop')].map(prefix);
  // os.tmpdir() is /var/folders/... on macOS, so /tmp needs naming separately.
  if (exempt.some((p) => file.startsWith(p)) || /\/\.claude\/|^\/tmp\//.test(file)) process.exit(0);
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|c|h|cpp|hpp|cc|vue|svelte|sql|sh|json|ya?ml|toml)$/.test(file)) {
    deny(`Root cannot write source or config (${path.basename(file)}).`);
  }
  process.exit(0);
}

// Fail-closed from here: an expression this cannot parse is denied, because a restriction
// that waves through what it does not understand is not a restriction.
const cmd = payload.tool_input?.command || '';

// Quoting decides: `jq '.a | .b'` is one command, not two. Metacharacters are matched against
// a copy with escapes and quoted spans blanked out, then segments are sliced from the original.
// Single quotes suppress substitution too, double quotes do not — hence two masks.
const blank = (m) => (m[0] === '\\' ? 'xx' : m[0] + 'x'.repeat(m.length - 2) + m[0]);
const masked = cmd.replace(/\\.|'[^']*'|"(?:[^"\\]|\\.)*"/gs, blank);
const unexpanded = cmd.replace(/\\.|'[^']*'/gs, blank);

if (/[<>]/.test(masked)) deny('Root cannot redirect (`>`, `<`).');
if (/[`]|\$\(/.test(unexpanded)) deny('Root cannot use command substitution.');

const READ_ONLY = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'du', 'df',
  'find', 'grep', 'rg', 'sort', 'uniq', 'cut', 'tr', 'echo', 'pwd', 'which', 'env', 'date',
  'jq', 'tree', 'basename', 'dirname', 'realpath', 'readlink', 'diff']);
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'blame', 'ls-files', 'rev-parse',
  'merge-base', 'describe']);
const GH_READ = { pr: ['view', 'list', 'diff'], issue: ['view', 'list'], repo: ['view'], run: ['view', 'list'] };
// Options that turn an otherwise read-only command into a writer or a launcher.
const FORBIDDEN_OPTS = {
  sort: /^(-o|--output|--compress-program)/,
  tree: /^-o/,
  git: /^--output/,
  find: /^-f(ls|print0?|printf)$/,
  rg: /^--pre(=|$)/,
};

const segments = [];
let cut = 0;
for (const m of masked.matchAll(/;|&&|\|\||\||&|\r|\n/g)) {
  segments.push(cmd.slice(cut, m.index));
  cut = m.index + m[0].length;
}
segments.push(cmd.slice(cut));

for (const seg of segments.map((s) => s.trim()).filter(Boolean)) {
  const argv = seg.split(/\s+/);
  const root = path.basename(argv[0]);
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) deny(`Root cannot set variables inline (\`${argv[0]}\`).`);

  if (root === 'git') {
    // -C and --no-pager are harmless globals; -c is not (alias.status='!rm' runs on `git status`).
    let i = 1;
    while (argv[i] === '--no-pager' || argv[i] === '-C') i += argv[i] === '-C' ? 2 : 1;
    const sub = argv[i];
    const rest = argv.slice(i + 1);
    const listing = ['branch', 'tag'].includes(sub) && rest.every((a) => /^-(l|a|r|v|-list|-all|-verbose|-show-current)$/.test(a));
    const stashRead = sub === 'stash' && ['list', 'show'].includes(rest[0]);
    if (!GIT_READ.has(sub) && !listing && !stashRead) deny(`Root cannot run \`git ${sub || ''}\`.`);
  } else if (root === 'gh') {
    const [, sub, verb] = argv;
    if (sub === 'api') {
      for (let i = 2; i < argv.length; i += 1) {
        const a = argv[i];
        if (/^(-X|--method)/.test(a)) {
          const v = a.startsWith('--method=') ? a.slice(9)
            : a.startsWith('-X') && a.length > 2 ? a.slice(2) : argv[i + 1] || '';
          if (v.toUpperCase() !== 'GET') deny(`Root cannot run \`gh api -X ${v}\`.`);
        }
        if (/^(-f|-F|--field|--raw-field|--input)/.test(a)) deny('Root cannot send a `gh api` request body.');
      }
    } else if (!GH_READ[sub]?.includes(verb)) {
      deny(`Root cannot run \`gh ${sub || ''} ${verb || ''}\`.`);
    }
  } else if (root === 'find') {
    if (argv.some((a) => /^-(exec|execdir|delete|ok|okdir)$/.test(a))) deny('Root cannot run `find` with an action flag.');
  } else if (root === 'env' && argv.slice(1).some((a) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a))) {
    deny('Root can run `env` only to read the environment.');
  }

  const forbidden = FORBIDDEN_OPTS[root] && argv.slice(1).find((a) => FORBIDDEN_OPTS[root].test(a));
  if (forbidden) deny(`Root cannot run \`${root}\` with a write or exec option (\`${forbidden}\`).`);

  if (!READ_ONLY.has(root) && root !== 'git' && root !== 'gh') deny(`Root cannot run \`${root}\`.`);
}
