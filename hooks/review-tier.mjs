#!/usr/bin/env node
// Prints the review effort tier for a diff: none|medium|high|xhigh.
// Deterministic floors — the model may escalate the printed tier with a stated reason,
// never downgrade it. Optional per-repo overrides: a .review-tiers file in the repo root,
// one rule per line: "<xhigh|high> <regex matched against changed paths>".
//
// Precision policy: repeated false xhigh trains users to distrust the classifier, so the
// xhigh floors are deliberately narrow (unambiguous payment/crypto/migration surfaces plus
// a strict content scan of added lines), while the broad risky vocabulary (auth, login,
// session, checkout, ...) floors at high.
//
// Node rather than the bash this started as: Claude Code's documented Windows shells are
// "Bash, Zsh, PowerShell, or CMD", so a hook that needs bash is a hook half the users
// cannot run. Node is already a hard dependency of every other hook here.
//
// Usage: node review-tier.mjs [repo-dir] [diff-base]
// The base defaults to HEAD, i.e. the working tree. Work you already committed on a branch
// leaves a clean tree and would classify as none, so pass the branch point for that:
//   node review-tier.mjs . "$(git merge-base origin/main HEAD)"
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const done = (tier) => { process.stdout.write(`${tier}\n`); process.exit(0); };

const repo = process.argv[2] || '.';
if (!fs.existsSync(repo)) done('none');

// Never throws: a failed git call is an empty result, which reads as "nothing changed"
// everywhere below. The one case that must not degrade to none is handled explicitly.
// The user's git config is overridden, not trusted: `color.ui=always` prefixes every diff
// line with ANSI and `diff.noprefix` moves the filename in the `+++` header. Either one
// makes the content scan below match nothing and lower the tier in silence.
const CONFIG = ['-c', 'color.ui=never', '-c', 'diff.noprefix=false'];
const git = (...args) => {
  try { return execFileSync('git', [...CONFIG, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) {
    // No git at all would read as "nothing changed" and skip the review without a trace.
    if (e.code === 'ENOENT') process.stderr.write('review-tier: git is not on PATH\n');
    return '';
  }
};
// An external diff driver replaces the format outright, and `--no-ext-diff` is a diff
// option rather than a global one, so it has to ride with every call.
const diff = (...args) => git('diff', '--no-ext-diff', ...args);
const lines = (out) => out.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);

if (!git('rev-parse', '--is-inside-work-tree').trim()) done('none');

// A base that does not resolve falls back to the working tree, never to none — a typo
// must not read as "no source changes, skip the review".
let base = process.argv[3] || 'HEAD';
if (!git('rev-parse', '--verify', '--quiet', base).trim()) {
  process.stderr.write(`review-tier: base '${base}' does not resolve; using HEAD\n`);
  base = 'HEAD';
}

const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|c|h|cpp|hpp|cc|vue|svelte|sql|sh|prisma)$/;
const untracked = lines(git('ls-files', '--others', '--exclude-standard'));
const src = [...new Set([...lines(diff('--name-only', base, '--')), ...untracked])]
  .filter((f) => EXT.test(f))
  .sort();
if (!src.length) done('none');

let tier = 'medium';
const raise = (t) => {
  if (t === 'xhigh') tier = 'xhigh';
  else if (t === 'high' && tier === 'medium') tier = 'high';
};

// Per-repo overrides first (can only raise, never lower)
const overrides = path.join(repo, '.review-tiers');
if (fs.existsSync(overrides)) {
  for (const line of lines(fs.readFileSync(overrides, 'utf8'))) {
    const [t, ...rest] = line.trim().split(/\s+/);
    const pattern = rest.join(' ');
    if ((t !== 'xhigh' && t !== 'high') || !pattern) continue;
    // A rule you typed wrong is skipped, not fatal: the classifier still has to print a
    // tier, and a crash here would take the whole review gate down with it.
    try { if (src.some((f) => new RegExp(pattern, 'i').test(f))) raise(t); } catch {}
  }
}

// xhigh path floors — narrow by design: migration/schema surfaces, payment providers,
// unambiguous crypto primitives ("crypt" alone would hit crypto-prices.ts)
const XHIGH_PATH = /(^|\/)(migrations?|migrate)(\/|$)|schema\.(prisma|sql)$|\.sql$|stripe|paypal|paddle|braintree|adyen|lemonsqueezy|iyzico|encrypt|decrypt|bcrypt|scrypt|argon2|hmac/i;
if (src.some((f) => XHIGH_PATH.test(f))) raise('xhigh');

// xhigh content floor — ADDED source lines (tracked diff + untracked source files),
// strong implementation signals only; bare SECRET/API_KEY/webhook/jwt are too noisy.
// Case-sensitive on purpose, unlike the path floors: the constant spellings are the signal.
if (tier !== 'xhigh') {
  const CONTENT = /(STRIPE|PAYPAL|PADDLE|BRAINTREE|ADYEN|LEMONSQUEEZY|IYZICO)[A-Z0-9_]*(SECRET|PRIVATE|API)[_-]?KEY|service_role|payment_intent|PaymentIntent|jwt\.sign|createHmac|constructEvent|verifyWebhook/;
  const added = [];
  let inSource = false;
  for (const line of diff(base, '--').split('\n')) {
    if (line.startsWith('+++ ')) { inSource = EXT.test(line.slice(6)); continue; }
    if (inSource && line.startsWith('+')) added.push(line);
  }
  for (const f of untracked.filter((u) => EXT.test(u))) {
    try { added.push(fs.readFileSync(path.join(repo, f), 'utf8')); } catch {}
  }
  if (CONTENT.test(added.join('\n'))) raise('xhigh');
}

// high floors — broad risky vocabulary (author excluded), middleware, size, server dirs
if (tier === 'medium') {
  const RISKY = /auth|login|logout|signin|signup|password|session|token|checkout|invoice|billing|payment|webhook|permission|rbac|acl|oauth|jwt|sso|otp|mfa|middleware/i;
  if (src.some((f) => RISKY.test(f) && !/author/i.test(f))) raise('high');
}
if (tier === 'medium') {
  const changed = lines(diff(base, '--numstat', '--'))
    .map((l) => l.split('\t'))
    .filter(([, , file]) => file && EXT.test(file))
    .reduce((sum, [add, del]) => sum + (Number(add) || 0) + (Number(del) || 0), 0);
  if (src.length > 3 || changed > 150) raise('high');
  if (src.some((f) => /\/(server|api|services|lib|db|models)\//i.test(f))) raise('high');
}

done(tier);
