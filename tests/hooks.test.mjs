import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INJECT = path.join(ROOT, 'hooks', 'advisor-inject.mjs');
const GATE = path.join(ROOT, 'hooks', 'advisor-gate.mjs');

const flagPath = (sid) => `/tmp/advisor-gate-${sid}.flag`;
const sids = [];

// The flag path is hard-coded to /tmp, not HOME, so a fixture dir cannot isolate these.
// A per-test session id does, as long as every one is removed afterwards.
function session(name) {
  const sid = `consigliere-test-${name}`;
  sids.push(sid);
  return sid;
}

test.after(() => {
  for (const sid of sids) fs.rmSync(flagPath(sid), { force: true });
});

function hook(script, payload) {
  return execFileSync(process.execPath, [script], { input: JSON.stringify(payload), encoding: 'utf8' });
}

function inject(sid, prompt, { flagged = true } = {}) {
  if (flagged) fs.writeFileSync(flagPath(sid), '');
  else fs.rmSync(flagPath(sid), { force: true });
  const stdout = hook(INJECT, { session_id: sid, prompt });
  return { stdout, flagKept: fs.existsSync(flagPath(sid)) };
}

// The bug this file exists for: a finishing background subagent arrives as a
// UserPromptSubmit event, and resetting on one deletes the flag the advisor call
// itself just set — leaving the gate impossible to satisfy for the rest of the task.
// Both literals are the shapes the harness actually emits, taken from live transcripts.
test('a task notification leaves the flag alone and prints nothing', () => {
  for (const prompt of [
    '[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event.',
    '<task-notification>\n<task-id>bubvqt1pj</task-id>\n<status>completed</status>\n</task-notification>',
  ]) {
    const r = inject(session(`notif-${prompt.length}`), prompt);
    assert.ok(r.flagKept, `flag should survive: ${prompt.slice(0, 40)}`);
    assert.equal(r.stdout, '', 'a notification is not a new task, so no directive');
  }
});

// This package's own audience quotes these tags while debugging their hooks, so an
// unanchored match would hand the next task a stale flag and no directive.
test('a prompt that merely quotes the notification tag is still a task', () => {
  const r = inject(session('quoted-tag'), 'why did <task-notification> not reset the flag in hooks/advisor-inject.mjs?');
  assert.equal(r.flagKept, false);
  assert.match(r.stdout, /ADVISOR\/EXECUTOR LOOP/);
});

test('a new code prompt resets the flag and prints the directive', () => {
  const r = inject(session('code'), 'fix the crash in src/app.ts');
  assert.equal(r.flagKept, false, 'a new task must start without a consult');
  assert.match(r.stdout, /ADVISOR\/EXECUTOR LOOP/);
});

test('a short approval keeps the flag so execution can continue', () => {
  const r = inject(session('ack'), 'devam');
  assert.ok(r.flagKept);
  assert.equal(r.stdout, '');
});

test('an approval word carrying a new task still resets the flag', () => {
  const r = inject(session('ack-task'), 'tamam, şimdi src/api.ts içindeki hatayı düzelt');
  assert.equal(r.flagKept, false);
});

test('gate denies a source write when no consult has run', () => {
  const sid = session('gate-deny');
  fs.rmSync(flagPath(sid), { force: true });
  const out = JSON.parse(hook(GATE, { session_id: sid, tool_input: { file_path: '/Users/x/proj/steps.ts' } }));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /retry this exact edit once it lands/);
  // The removed branch: offering "ask the user" turned every deny into a stall.
  assert.doesNotMatch(reason, /ask the user/i);
  // ...but a deny that repeats after a consult is a malfunction and needs a way out.
  assert.match(reason, /denied again after a consult/);
});

test('gate allows the write once the flag is there', () => {
  const sid = session('gate-allow');
  fs.writeFileSync(flagPath(sid), '');
  assert.equal(hook(GATE, { session_id: sid, tool_input: { file_path: '/Users/x/proj/steps.ts' } }), '');
});

test('gate ignores non-code and exempt paths', () => {
  const sid = session('gate-exempt');
  fs.rmSync(flagPath(sid), { force: true });
  for (const file of ['/Users/x/proj/notes.md', '/Users/x/.claude/hooks/thing.mjs', '/tmp/scratch.ts']) {
    assert.equal(hook(GATE, { session_id: sid, tool_input: { file_path: file } }), '', file);
  }
});
