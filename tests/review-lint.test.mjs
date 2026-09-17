// The lint is what keeps a review from growing a second round: it checks the shape of what
// came back and reports to the root, never to the reviewer. Its exit code is deliberately 0
// even on a mismatch, so that is pinned here too — a lint that starts gating would silently
// turn every shape problem into a blocked handoff.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINT = path.join(REPO, 'skills', 'review', 'review-lint.mjs');
const temps = [];

test.after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

// redis.ts changes lines 57-65; reconcile.ts is new, so its whole 1-12 is the hunk.
const DIFF = `diff --git a/apps/api/src/redis.ts b/apps/api/src/redis.ts
index 1111111..2222222 100644
--- a/apps/api/src/redis.ts
+++ b/apps/api/src/redis.ts
@@ -57,6 +57,9 @@ export async function withLock(
   const token = \`\${Date.now()}-\${Math.random()}\`;
   const result = await redis.set(key, token, "NX", "EX", String(ttlSeconds));
   if (!result) {
+    console.log(\`[lock] \${key} already held, skipping\`);
+    return false;
+  }
   try {
     await fn();
   } finally {
diff --git a/apps/api/src/jobs/reconcile.ts b/apps/api/src/jobs/reconcile.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/apps/api/src/jobs/reconcile.ts
@@ -0,0 +1,12 @@
+export async function reconcile() {
+  for (const c of await customers()) {
+    await fetchSubs(c);
+  }
+}
`;

function lint(findings, { diff = DIFF } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-lint-'));
  temps.push(dir);
  const diffPath = path.join(dir, 'diff.patch');
  const findingsPath = path.join(dir, 'findings.json');
  fs.writeFileSync(diffPath, diff);
  fs.writeFileSync(findingsPath, JSON.stringify(findings));
  const out = execFileSync(process.execPath, [LINT, diffPath, findingsPath], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out.split('\n').filter(Boolean);
}

test('a review that fits the contract reports nothing', () => {
  assert.deepEqual(lint([
    { label: 'ADOPT', file: 'apps/api/src/jobs/reconcile.ts', line: '2-5', text: 'fetch inside an unbounded loop under a lock' },
    { label: 'NOTE', file: 'apps/api/src/redis.ts', line: 60, text: 'the skip log is unstructured' },
  ]), []);
});

test('a line range counts as cited when its first line is in a hunk', () => {
  assert.deepEqual(lint([{ label: 'ADOPT', file: 'apps/api/src/redis.ts', line: '58-61', text: 'x' }]), []);
});

test('a path is matched by suffix, so a repo-relative citation still resolves', () => {
  assert.deepEqual(lint([{ label: 'ADOPT', file: 'src/redis.ts', line: 58, text: 'x' }]), []);
});

test('a line outside every changed hunk is reported', () => {
  assert.deepEqual(lint([{ label: 'ADOPT', file: 'apps/api/src/redis.ts', line: 900, text: 'x' }]),
    ['apps/api/src/redis.ts:900 is outside every changed hunk']);
});

test('a file that is not in the diff is reported once, without a line check', () => {
  assert.deepEqual(lint([{ label: 'ADOPT', file: 'apps/api/src/entitlement.ts', line: 10, text: 'x' }]),
    ['apps/api/src/entitlement.ts is not in the diff that was reviewed']);
});

test('a label that is neither ADOPT nor NOTE is reported', () => {
  assert.deepEqual(lint([{ label: 'STYLE', file: 'apps/api/src/redis.ts', line: 58, text: 'x' }]),
    ['label "STYLE" is neither ADOPT nor NOTE — apps/api/src/redis.ts:58']);
});

test('each cap is reported when it is exceeded, and not when it is met', () => {
  const adopt = (n) => Array.from({ length: n }, () => ({ label: 'ADOPT', file: 'apps/api/src/redis.ts', line: 58, text: 'x' }));
  const note = (n) => Array.from({ length: n }, () => ({ label: 'NOTE', file: 'apps/api/src/redis.ts', line: 58, text: 'x' }));
  assert.deepEqual(lint([...adopt(5), ...note(3)]), []);
  assert.deepEqual(lint(adopt(6)), ['6 ADOPT findings, cap is 5']);
  assert.deepEqual(lint(note(4)), ['4 NOTE findings, cap is 3']);
});

test('every problem in one review is reported, findings first and caps last', () => {
  const findings = [
    { label: 'ADOPT', file: 'apps/api/src/jobs/reconcile.ts', line: 2, text: 'a' },
    { label: 'ADOPT', file: 'apps/api/src/jobs/reconcile.ts', line: 5, text: 'b' },
    { label: 'ADOPT', file: 'apps/api/src/redis.ts', line: 58, text: 'c' },
    { label: 'ADOPT', file: 'apps/api/src/redis.ts', line: 60, text: 'd' },
    { label: 'ADOPT', file: 'apps/api/src/redis.ts', line: 900, text: 'e' },
    { label: 'ADOPT', file: 'apps/api/src/entitlement.ts', line: 10, text: 'f' },
    { label: 'ADOPT', file: 'apps/api/src/jobs/reconcile.ts', line: 8, text: 'g' },
    { label: 'STYLE', file: 'apps/api/src/jobs/reconcile.ts', line: 3, text: 'h' },
  ];
  assert.deepEqual(lint(findings), [
    'apps/api/src/redis.ts:900 is outside every changed hunk',
    'apps/api/src/entitlement.ts is not in the diff that was reviewed',
    'label "STYLE" is neither ADOPT nor NOTE — apps/api/src/jobs/reconcile.ts:3',
    '7 ADOPT findings, cap is 5',
  ]);
});

// Shadow mode. Until it has run clean on enough real reviews to have earned a gate, a
// mismatch is the root's to judge, so the exit code stays 0 whatever it found.
test('exits 0 whether the review was clean or not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-lint-'));
  temps.push(dir);
  fs.writeFileSync(path.join(dir, 'diff.patch'), DIFF);
  for (const [name, findings] of [
    ['clean.json', [{ label: 'ADOPT', file: 'apps/api/src/redis.ts', line: 58, text: 'x' }]],
    ['broken.json', [{ label: 'STYLE', file: 'nowhere.ts', line: 900, text: 'x' }]],
  ]) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(findings));
    const r = execFileSync(process.execPath, [LINT, path.join(dir, 'diff.patch'), path.join(dir, name)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    assert.equal(typeof r, 'string');
  }
});

test('exits 2 when an argument is missing', () => {
  const run = (args) => {
    try {
      execFileSync(process.execPath, [LINT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return 0;
    } catch (e) {
      return e.status;
    }
  };
  assert.equal(run([]), 2);
  assert.equal(run(['only-one.patch']), 2);
});
