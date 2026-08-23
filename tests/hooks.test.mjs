import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INJECT = path.join(ROOT, 'hooks', 'advisor-inject.mjs');
const GATE = path.join(ROOT, 'hooks', 'advisor-gate.mjs');
const LANG = path.join(ROOT, 'hooks', 'commit-language.mjs');
const MARK = path.join(ROOT, 'hooks', 'advisor-mark.mjs');

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
  for (const sid of sids) {
    fs.rmSync(flagPath(sid), { force: true });
    fs.rmSync(`/tmp/advisor-agents-${sid}.json`, { force: true });
  }
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

const marked = (sid) => fs.existsSync(flagPath(sid));

test('mark clears the gate on an advisor spawn and on a later SendMessage to it', () => {
  // The rule spawns one named advisor per task and continues it with SendMessage, so a
  // mark that only fired on Task would gate work that was in fact consulted.
  const sid = session('mark-roster');
  fs.rmSync(flagPath(sid), { force: true });
  fs.rmSync(`/tmp/advisor-agents-${sid}.json`, { force: true });

  hook(MARK, { session_id: sid, tool_input: { to: 'reviewer' } });
  assert.equal(marked(sid), false, 'an unknown recipient is not a consult');

  hook(MARK, { session_id: sid, tool_input: { subagent_type: 'advisor', name: 'reviewer' } });
  assert.equal(marked(sid), true);

  // The roster outlives the flag, which advisor-inject.mjs deletes on every new task prompt.
  fs.rmSync(flagPath(sid), { force: true });
  hook(MARK, { session_id: sid, tool_input: { to: 'reviewer' } });
  assert.equal(marked(sid), true, 'a continuation of that advisor is a consult');

  fs.rmSync(flagPath(sid), { force: true });
  hook(MARK, { session_id: sid, tool_input: { to: 'some-other-agent' } });
  assert.equal(marked(sid), false, 'talking to anyone else is not');
});

test('mark ignores a non-advisor subagent', () => {
  const sid = session('mark-other-agent');
  fs.rmSync(flagPath(sid), { force: true });
  hook(MARK, { session_id: sid, tool_input: { subagent_type: 'general-purpose', name: 'helper' } });
  assert.equal(marked(sid), false);
});

const lang = (command) => hook(LANG, { tool_name: 'Bash', tool_input: { command } });
const blocked = (command) => lang(command) !== '';

test('language gate blocks real Turkish commit subjects', () => {
  // Taken verbatim from this user's own history — the leak the hook exists for.
  const subjects = [
    "fix(api): market change_percent taşması fiyat batch'ini düşürmesin",
    'revert: next 16.3.0 denemesi ve docker tanı adımları geri alındı',
    "chore: yedekleme betikleri ve geri yukleme runbook'u",
  ];
  for (const s of subjects) assert.ok(blocked(`git commit -m "${s}"`), s);
});

test('language gate misses diacritic-free Turkish, and that is the accepted trade', () => {
  // `devir isleri ekrani` carries no ğ/ş/ı and no scored suffix. Catching it would need
  // signals that also fire on English, and a false positive is the failure mode that
  // gets a hook disabled.
  assert.equal(lang('git commit -m "feat(web): devir isleri ekrani"'), '');
});

test('language gate leaves English alone', () => {
  const subjects = [
    'feat(api): add retry budget to the pricing batch',
    'fix: guard against a missing session id in the gate hook',
    'refactor(web): split the settings form into smaller components',
    'chore: bump node to 24 and regenerate the lockfile',
  ];
  for (const s of subjects) assert.equal(lang(`git commit -m "${s}"`), '', s);
});

test('language gate scores every -m, not just the subject', () => {
  const out = lang('git commit -m "feat: add the export button" -m "bu ekran icin gerekli bir degisiklik"');
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
});

test('language gate reads a heredoc body', () => {
  assert.ok(blocked(`gh pr create --title "feat: export" --body "$(cat <<'EOF'
Rapor sayfası artık toplamları doğru hesaplıyor ve dışa aktarım çalışıyor.
EOF
)"`));
});

test('language gate exempts quoted product copy', () => {
  // rules/communication.md keeps user-facing strings in the product's locale, so an
  // English body may legitimately quote Turkish UI text.
  assert.equal(lang(`git commit -m "feat(web): add the export toast" -m "The button now shows 'Rapor indiriliyor, lütfen bekleyin' while the file is built."`), '');
});

test('language gate fails open on text it cannot read', () => {
  // -F/--body-file point at a file the hook never opens. Passing beats guessing.
  assert.equal(lang('git commit -F /tmp/message.txt'), '');
  assert.equal(lang('gh pr create --body-file /tmp/body.md'), '');
});

test('language gate does not read all-caps acronyms as Turkish stopwords', () => {
  // Turkish lowercasing maps I to ı, so `MI` and `BU` land straight in the stopword set.
  assert.equal(lang('git commit -m "docs: add the MI runbook" -m "BU and MI dashboards are linked"'), '');
});

test('language gate extracts a quoted heredoc once, not twice', () => {
  // `--body "$(cat <<EOF …)"` matches both passes; scoring it twice halves the threshold.
  assert.equal(lang(`gh pr create --title "feat: export" --body "$(cat <<'EOF'
Adds the export button ve nothing else changes here.
EOF
)"`), '');
});

test('language gate covers the other ways a message reaches the repo', () => {
  // `git -C` is routine in an agent session, where cwd resets between calls.
  assert.ok(blocked('git -C /Users/x/proj commit -m "fix: rapor sayfası artık doğru toplamı gösteriyor"'));
  assert.ok(blocked('gh pr edit 12 --body "bu değişiklik raporlama ekranını düzeltiyor"'));
  assert.ok(blocked('git tag -a v1.2.0 -m "sürüm notları ve düzeltmeler burada"'));
  // A tag command with nothing to score exits before the language pass.
  assert.equal(lang('git tag v1.2.0'), '');
});

test('language gate ignores commands that are not a commit or a PR', () => {
  assert.equal(lang('git log --oneline -m 5'), '');
  assert.equal(lang('echo "bu bir türkçe cümledir ve engellenmemeli"'), '');
});
