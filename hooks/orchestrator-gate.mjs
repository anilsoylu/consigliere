#!/usr/bin/env node
// Keeps the root session out of the code. It still runs the plumbing — verifiers, git, gh.
// agent_id is present only when a hook fires inside a subagent, so its absence identifies
// the orchestrator's own thread —
// which is why this cannot be a permissions.deny rule: those apply to workers too.
// The field belongs to Claude Code, not to this repo; `node doctor.mjs --probe` verifies it
// against the installed build.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cfgDir } from './config-dir.mjs';

const ROUTE = 'Root writes no code. It runs the plumbing itself: verifiers, git, gh. '
  + 'Delegate the rest: `worker` for code, `tester` for verification. '
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

// Typed, not truthy: a field that changed shape must not read as a subagent.
if (typeof payload.agent_id === 'string' && payload.agent_id) process.exit(0);

const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
// The trailing separator is deliberate: a bare prefix would also exempt /tmpfoo/x.ts.
const prefix = (p) => `${norm(p).replace(/\/$/, '')}/`;
// The prefix test is a string compare, so both spellings of a macOS temp dir have to collapse
// to one, and a symlink out of a temp root must not carry a write with it. Paths that do not
// exist yet resolve through their nearest existing parent.
const canon = (p) => {
  let head = path.resolve(p);
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(head), ...tail); } catch { /* not created yet */ }
    const up = path.dirname(head);
    if (up === head) return path.resolve(p);
    tail.unshift(path.basename(head));
    head = up;
  }
};

if (payload.tool_name !== 'Bash') {
  const raw = payload.tool_input?.file_path || '';
  if (!raw) process.exit(0);
  const file = norm(canon(raw));
  const exempt = [os.tmpdir(), '/tmp', cfgDir(), path.join(os.homedir(), 'Desktop')]
    .map((p) => prefix(canon(p)));
  // A project-local .claude/ is the root's too, wherever it sits.
  if (exempt.some((p) => file.startsWith(p)) || /\/\.claude\//.test(file)) process.exit(0);
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|c|h|cpp|hpp|cc|vue|svelte|sql|sh|json|ya?ml|toml)$/.test(file)) {
    deny(`Root cannot write source or config (${path.basename(file)}).`);
  }
  process.exit(0);
}

// Fail-closed from here: an expression this cannot parse is denied, because a restriction
// that waves through what it does not understand is not a restriction.
const cmd = payload.tool_input?.command || '';
const cwd = payload.cwd || '.';

// Quoting decides: `jq '.a | .b'` is one command, not two. Metacharacters are matched against
// a copy with escapes and quoted spans blanked out, then segments are sliced from the original.
// Single quotes suppress substitution too, double quotes do not — hence two masks.
const blank = (m) => (m[0] === '\\' ? 'xx' : m[0] + 'x'.repeat(m.length - 2) + m[0]);
const masked = cmd.replace(/\\.|'[^']*'|"(?:[^"\\]|\\.)*"/gs, blank);
const unexpanded = cmd.replace(/\\.|'[^']*'/gs, blank);

// A verifier's log has to land somewhere, so an output redirect into a temp dir passes and
// every other target, plus any input redirect, does not. The spans are blanked afterwards so
// the segment split below never reads the `&` in `2>&1` as a separator.
const REDIRECT = /(?:&>>?|\d?>>?|\d?<)\s*(?:&\d+|[^\s;|&<>]*)/g;
const tmpRoots = [os.tmpdir(), '/tmp'].map((p) => prefix(canon(p)));
const redirects = [];
for (const m of masked.matchAll(REDIRECT)) {
  const target = cmd.slice(m.index, m.index + m[0].length)
    .replace(/^(?:&>>?|\d?>>?|\d?<)\s*/, '').replace(/^["']|["']$/g, '');
  // Resolved before the prefix test, or `/tmp/../repo/src/a.ts` would read as a temp path.
  // The posix spelling only applies where path.resolve picks a drive (#61); on POSIX it would
  // skip the realpath and let a symlink out of /tmp through.
  const ok = !m[0].includes('<')
    && (/^&\d+$/.test(target)
      || tmpRoots.some((p) => norm(canon(path.resolve(cwd, target))).startsWith(p))
      || (process.platform === 'win32' && path.posix.normalize(norm(target)).startsWith('/tmp/')));
  if (!ok) deny('Root cannot redirect (`>`, `<`).');
  redirects.push([m.index, m[0].length]);
}
const unredirected = (s) => redirects.reduce(
  (acc, [i, len]) => acc.slice(0, i) + ' '.repeat(len) + acc.slice(i + len), s);
const flow = unredirected(masked);
const line = unredirected(cmd);

if (/[`]|\$\(/.test(unexpanded)) deny('Root cannot use command substitution.');

const READ_ONLY = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'du', 'df',
  'find', 'grep', 'rg', 'sort', 'uniq', 'cut', 'tr', 'echo', 'pwd', 'which', 'env', 'date',
  'jq', 'tree', 'basename', 'dirname', 'realpath', 'readlink', 'diff']);
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'blame', 'ls-files', 'rev-parse',
  'merge-base', 'describe']);
const GIT_PLUMBING = new Set(['add', 'commit', 'push', 'fetch', 'pull', 'checkout', 'switch',
  'branch', 'tag', 'rebase', 'restore', 'reset']);
// Subcommand forms that overwrite the working tree instead of moving a ref, so a root cannot
// discard a worker's uncommitted change. `--force` is the FORCE GATE's in git-discipline.mjs.
const WIPES = {
  reset: (rest) => rest.some((a) => /^--(hard|merge|keep)$/.test(a)),
  restore: (rest) => !rest.includes('--staged') || rest.some((a) => /^(-W|--worktree)$/.test(a)),
  // A pathspec turns checkout into a file restore; a branch name only moves HEAD.
  checkout: (rest, base) => rest.includes('--')
    || rest.some((a) => /^(-f|--force|-B)$/.test(a))
    || rest.some((a) => !a.startsWith('-') && fs.existsSync(path.resolve(base, a))),
  switch: (rest) => rest.some((a) => /^(-f|--force|--discard-changes|-C)$/.test(a)),
};
const GH_ALLOWED = {
  pr: ['view', 'list', 'diff', 'create', 'edit', 'ready', 'merge', 'comment', 'checks'],
  issue: ['view', 'list'],
  repo: ['view'],
  run: ['view', 'list'],
  release: ['view', 'list'],
};
// Test runners the root reads an exit code from. Anything else on these roots stays denied,
// so `npm test` passes and `npm run build` does not.
const VERIFIERS = [
  (a) => a[0] === 'node' && a[1] === '--test',
  (a) => a[0] === 'node' && path.resolve(a[1] || '') === path.join(cfgDir(), 'hooks', 'review-tier.mjs'),
  (a) => /^(npm|pnpm|yarn|bun)$/.test(a[0]) && (a[1] === 'test' || (a[1] === 'run' && /^test/.test(a[2] || ''))),
  (a) => a[0] === 'npx' && /^(vitest|jest|mocha|tap)$/.test(a[1] || ''),
  (a) => a[0] === 'pytest',
  (a) => (a[0] === 'go' || a[0] === 'cargo') && a[1] === 'test',
];
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
for (const m of flow.matchAll(/;|&&|\|\||\||&|\r|\n/g)) {
  segments.push(line.slice(cut, m.index));
  cut = m.index + m[0].length;
}
segments.push(line.slice(cut));

for (const seg of segments.map((s) => s.trim()).filter(Boolean)) {
  const argv = seg.split(/\s+/);
  const root = path.basename(argv[0]);
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) deny(`Root cannot set variables inline (\`${argv[0]}\`).`);

  if (root === 'git') {
    // -C and --no-pager are harmless globals; -c is not (alias.status='!rm' runs on `git status`).
    let i = 1;
    let dir = '.';
    while (argv[i] === '--no-pager' || argv[i] === '-C') {
      if (argv[i] === '-C') dir = argv[i + 1] || '.';
      i += argv[i] === '-C' ? 2 : 1;
    }
    const sub = argv[i];
    const rest = argv.slice(i + 1);
    const listing = ['branch', 'tag'].includes(sub) && rest.every((a) => /^-(l|a|r|v|-list|-all|-verbose|-show-current)$/.test(a));
    const stashRead = sub === 'stash' && ['list', 'show'].includes(rest[0]);
    if (!GIT_READ.has(sub) && !GIT_PLUMBING.has(sub) && !listing && !stashRead) deny(`Root cannot run \`git ${sub || ''}\`.`);
    if (WIPES[sub]?.(rest, path.resolve(cwd, dir))) deny(`Root cannot run \`git ${sub}\` over the working tree.`);
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
    } else if (!GH_ALLOWED[sub]?.includes(verb)) {
      deny(`Root cannot run \`gh ${sub || ''} ${verb || ''}\`.`);
    }
  } else if (root === 'find') {
    if (argv.some((a) => /^-(exec|execdir|delete|ok|okdir)$/.test(a))) deny('Root cannot run `find` with an action flag.');
  } else if (root === 'env' && argv.slice(1).some((a) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(a))) {
    deny('Root can run `env` only to read the environment.');
  }

  const forbidden = FORBIDDEN_OPTS[root] && argv.slice(1).find((a) => FORBIDDEN_OPTS[root].test(a));
  if (forbidden) deny(`Root cannot run \`${root}\` with a write or exec option (\`${forbidden}\`).`);

  const verifier = VERIFIERS.some((v) => v([root, ...argv.slice(1)]));
  if (!READ_ONLY.has(root) && root !== 'git' && root !== 'gh' && !verifier) deny(`Root cannot run \`${root}\`.`);
}
