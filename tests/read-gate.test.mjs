import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = path.join(REPO, 'hooks', 'read-gate.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-gate-'));
const big = path.join(dir, 'big.ts');
const small = path.join(dir, 'small.ts');
const exact = path.join(dir, 'exact.ts');
const png = path.join(dir, 'big.png');

before(() => {
  fs.writeFileSync(big, 'x\n'.repeat(400));
  fs.writeFileSync(small, 'x\n'.repeat(20));
  fs.writeFileSync(exact, 'x\n'.repeat(350));
  fs.writeFileSync(png, 'x\n'.repeat(400));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (payload, env = {}) => {
  const r = spawnSync('node', [hook], {
    input: JSON.stringify({ cwd: dir, ...payload }),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  return r.stdout;
};
const read = (input, extra = {}) => run({ tool_name: 'Read', tool_input: input, ...extra });
const bash = (command, env) => run({ tool_name: 'Bash', tool_input: { command } }, env);
const denied = (out) => JSON.parse(out).hookSpecificOutput.permissionDecision === 'deny';

test('Read of a small file passes', () => assert.equal(read({ file_path: small }), ''));
test('Read of a big file is denied', () => assert.ok(denied(read({ file_path: big }))));
test('Read of a file at the threshold passes', () => assert.equal(read({ file_path: exact }), ''));
test('Read of an image passes', () => assert.equal(read({ file_path: png }), ''));
test('Read with limit passes', () => assert.equal(read({ file_path: big, limit: 100 }), ''));
test('subagent Read passes', () => assert.equal(read({ file_path: big }, { agent_id: 'x' }), ''));
test('cat big is denied', () => assert.ok(denied(bash(`cat ${big}`))));
test('head big passes', () => assert.equal(bash(`head ${big}`), ''));
test('head -n 50 big passes', () => assert.equal(bash(`head -n 50 ${big}`), ''));
test('head -50 big passes', () => assert.equal(bash(`head -50 ${big}`), ''));
test('head --lines=400 big is denied', () => assert.ok(denied(bash(`head --lines=400 ${big}`))));
test('tail -n +1 big is denied', () => assert.ok(denied(bash(`tail -n +1 ${big}`))));
test('head -n -5 big is denied', () => assert.ok(denied(bash(`head -n -5 ${big}`))));
test('cat small | wc -l passes', () => assert.equal(bash(`cat ${small} | wc -l`), ''));
test('raised threshold passes', () => assert.equal(bash(`cat ${big}`, { READ_GATE_MAX_LINES: '10000' }), ''));
