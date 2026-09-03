// The tier classifier decides how much review a diff gets, and nothing downstream can
// notice when it is wrong — a silent none skips the review entirely. So every floor is
// pinned here against a real git repository rather than a mocked diff.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIER = path.join(REPO, 'hooks', 'review-tier.mjs');
const temps = [];

test.after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

// Identity and signing come from flags, not the machine: a contributor whose global git
// config demands a GPG key would otherwise fail this suite and not the code.
const git = (cwd, ...args) => execFileSync('git', [
  '-c', 'user.email=test@example.com', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', ...args,
], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function repo(files = {}, { commit = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-tier-'));
  temps.push(dir);
  git(dir, 'init', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'seed');
  write(dir, files);
  if (commit) { git(dir, 'add', '-A'); git(dir, 'commit', '-m', 'work'); }
  return dir;
}

function write(dir, files) {
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  }
}

function tier(dir, base) {
  const args = base === undefined ? [TIER, dir] : [TIER, dir, base];
  return execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// The base defaults to HEAD, so committed work needs the branch point passed in.
const since = (dir) => tier(dir, git(dir, 'rev-parse', 'HEAD~1').trim());

test('prints none outside a repository and for a path that does not exist', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-tier-'));
  temps.push(plain);
  assert.equal(tier(plain), 'none');
  assert.equal(tier(path.join(plain, 'nope')), 'none');
});

test('prints none when nothing that changed is source', () => {
  assert.equal(since(repo({ 'docs/guide.md': 'text\n', 'config.json': '{}\n' })), 'none');
});

test('routine source lands on medium', () => {
  assert.equal(since(repo({ 'button.tsx': 'export const Button = () => null\n' })), 'medium');
});

test('risky vocabulary in a path floors at high, but author does not', () => {
  assert.equal(since(repo({ 'session-store.ts': 'export const store = 1\n' })), 'high');
  assert.equal(since(repo({ 'author-token.ts': 'export const a = 1\n' })), 'medium');
});

test('more than three source files, or a server directory, floors at high', () => {
  assert.equal(since(repo({ 'a.ts': '1\n', 'b.ts': '1\n', 'c.ts': '1\n', 'd.ts': '1\n' })), 'high');
  assert.equal(since(repo({ 'src/api/list.ts': 'export const list = []\n' })), 'high');
});

test('payment, crypto and migration paths floor at xhigh', () => {
  assert.equal(since(repo({ 'lib/stripe-client.ts': 'export const c = 1\n' })), 'xhigh');
  assert.equal(since(repo({ 'db/migrations/001-init.sql': 'select 1;\n' })), 'xhigh');
  assert.equal(since(repo({ 'utils/bcrypt-helper.ts': 'export const h = 1\n' })), 'xhigh');
});

test('an added implementation signal floors at xhigh even on a harmless path', () => {
  assert.equal(since(repo({ 'helper.ts': 'export const sign = () => jwt.sign(payload)\n' })), 'xhigh');
  // The content floor is case-sensitive: the constant spellings ARE the signal, and a
  // case-insensitive scan would fire on any file that says "service_role" in prose.
  assert.equal(since(repo({ 'helper.ts': 'export const sign = () => JWT.SIGN(payload)\n' })), 'medium');
});

// A contributor with color.ui=always gets ANSI in front of every diff line, which makes
// the `+++`/`+` parse miss and drops the tier without a word.
test('the content floor survives a repo configured to colour its diffs', () => {
  const dir = repo({ 'helper.ts': 'export const sign = () => jwt.sign(payload)\n' });
  git(dir, 'config', 'color.ui', 'always');
  assert.equal(since(dir), 'xhigh');
});

test('untracked source is scanned for content, not only listed', () => {
  const dir = repo({}, { commit: false });
  write(dir, { 'scratch.ts': 'const key = STRIPE_SECRET_KEY\n' });
  assert.equal(tier(dir), 'xhigh');
});

test('a .review-tiers rule raises the tier and a broken one is skipped', () => {
  const dir = repo({ 'button.tsx': 'export const Button = () => null\n' }, { commit: false });
  write(dir, { '.review-tiers': 'high \\.tsx$\n' });
  assert.equal(tier(dir), 'high');
  write(dir, { '.review-tiers': 'high [unclosed\n' });
  assert.equal(tier(dir), 'medium');
});

test('a .review-tiers rule reaches paths that are not source extensions', () => {
  const dir = repo({ 'skills/clean/SKILL.md': 'do the thing\n' }, { commit: false });
  assert.equal(tier(dir), 'none');
  write(dir, { '.review-tiers': 'high ^nope/\n' });
  assert.equal(tier(dir), 'none');
  write(dir, { '.review-tiers': 'high ^skills/.*\\.md$\n' });
  assert.equal(tier(dir), 'high');
});

// Invoked from a package inside a monorepo, the classifier used to print a lower tier: it
// looked for .review-tiers in that package and never listed untracked files outside it.
test('a subdirectory classifies the whole repository, not just itself', () => {
  const dir = repo({
    'skills/clean/SKILL.md': 'do the thing\n',
    'sub/keep.md': 'sub\n',
    '.review-tiers': 'high ^skills/.*\\.md$\n',
  }, { commit: false });
  const sub = path.join(dir, 'sub');
  assert.equal(tier(sub), 'high');
  write(dir, { 'scratch.ts': 'const key = STRIPE_SECRET_KEY\n' });
  assert.equal(tier(sub), 'xhigh');
});

test('a base that does not resolve falls back to HEAD, never to none', () => {
  const dir = repo({ 'session.ts': 'export const s = 1\n' }, { commit: false });
  const proc = execFileSync(process.execPath, [TIER, dir, 'no-such-ref'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(proc.trim(), 'high');
});
