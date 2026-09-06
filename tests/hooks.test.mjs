import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(ROOT, 'hooks', 'orchestrator-gate.mjs');
const LANG = path.join(ROOT, 'hooks', 'commit-language.mjs');

const handoffPath = (sid) => path.join(os.tmpdir(), `handoff-${sid}.flag`);
const sids = [];
const homes = [];

// The flag lives in the OS temp dir, not HOME, so a fixture dir cannot isolate these.
// A per-test session id does, as long as every one is removed afterwards.
function session(name) {
  const sid = `consigliere-test-${name}`;
  sids.push(sid);
  return sid;
}

test.after(() => {
  for (const sid of sids) fs.rmSync(handoffPath(sid), { force: true });
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
});

// The gate keys on the absence of agent_id and self-gates on rules/orchestrator.md, so
// every case points CLAUDE_CONFIG_DIR at a fixture carrying that rule.
const rootEdit = (file, tool = 'Edit') => ({ tool_name: tool, tool_input: { file_path: file } });
const rootBash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const decision = (out) => (out === '' ? 'allow' : JSON.parse(out).hookSpecificOutput.permissionDecision);

test('gate stands down without its rule, and inside a subagent', () => {
  assert.equal(envHook(GATE, rootBash('rm x'), cfgFixture({ orchestrator: false })), '');
  const cfg = cfgFixture();
  assert.equal(envHook(GATE, { ...rootBash('rm -rf /'), agent_id: 'sub-1' }, cfg), '');
});

// The field is Claude Code's, so a shape change is a real failure mode: anything but a
// non-empty string has to read as the root rather than waving the call through.
test('gate reads agent_id as a non-empty string, not as truthiness', () => {
  const cfg = cfgFixture();
  for (const agentId of [123, '', true]) {
    assert.equal(decision(envHook(GATE, { ...rootBash('rm -rf /'), agent_id: agentId }, cfg)), 'deny', String(agentId));
  }
});

test('gate denies root writes to source and config', () => {
  const cfg = cfgFixture();
  for (const [file, tool] of [['/repo/src/a.ts', 'Edit'], ['/repo/tsconfig.json', 'Write'], ['/tmpfoo/x.ts', 'Write']]) {
    assert.equal(decision(envHook(GATE, rootEdit(file, tool), cfg)), 'deny', file);
  }
});

test('the deny reason names the roles that can do the work', () => {
  const cfg = cfgFixture();
  const out = JSON.parse(envHook(GATE, rootEdit('/repo/src/a.ts'), cfg));
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /worker/);
  assert.match(reason, /tester/);
});

// The config dir, the plans a root does write, and both temp roots stay open. The
// /tmpfoo case above is the reason the exemption carries a trailing separator.
test('gate leaves the root its own files', () => {
  const cfg = cfgFixture();
  const allowed = [
    [path.join(cfg, 'hooks', 'x.mjs'), 'Edit'],
    ['/repo/plans/notes.md', 'Write'],
    ['/tmp/scratch.mjs', 'Write'],
    [path.join(os.tmpdir(), 'x.ts'), 'Write'],
  ];
  for (const [file, tool] of allowed) {
    assert.equal(envHook(GATE, rootEdit(file, tool), cfg), '', file);
  }
});

test('gate allows read-only root commands, the plumbing and the verifiers', () => {
  const cfg = cfgFixture();
  const allowed = [
    'git diff',
    'git commit -m x',
    'git push -u origin b',
    'git checkout -b b',
    'git tag -a v1 -m m',
    'git rebase origin/main',
    // `--` is a pathspec separator on a read and inside a message; only checkout wipes with it.
    'git diff HEAD -- src/',
    'git log --oneline -- hooks/',
    'git add -- .',
    'git commit -m "a -- b"',
    'gh pr create --draft',
    'gh pr merge 5 --squash',
    'gh pr ready 5',
    'node --test tests/*.test.mjs > /tmp/t.log 2>&1',
    'npm test',
    'pytest -q',
    'sed -n 1,5p f.ts',
    'awk -F: "{print $1}" f.ts',
    'node /Users/x/.claude/hooks/review-tier.mjs . abc',
    'echo hi > /tmp/x',
    'git -C /x status',
    'git branch -a',
    "git log --format='%h|%s'",
    'cat a.ts | grep x',
    "jq -e '.a | .b' f.json",
    'grep "a>b" f.txt',
    "echo '$(whoami)'",
    'gh api repos/foo/bar',
    'gh api --method GET repos/x',
    'gh api -X GET repos/x',
    // The word `tee` as an argument is not the command `tee`; only argv[0] decides.
    'grep tee f.txt',
    'grep -o x f.txt',
    'git log --grep=eval',
    'grep "a\\|b" f.txt',
    "echo 'it\\'s'",
  ];
  for (const cmd of allowed) assert.equal(envHook(GATE, rootBash(cmd), cfg), '', cmd);
});

test('gate denies commands that write, spawn or expand', () => {
  const cfg = cfgFixture();
  const denied = [
    'git reset --hard',
    'git reset --merge',
    'git restore .',
    'git checkout .',
    'git checkout -- file.ts',
    'echo x > /tmp/../etc/passwd',
    'git -c alias.status=!rm status',
    'rm /tmp/x',
    'node script.mjs',
    'npm run build',
    'node --test > out.log',
    'cat < x',
    'echo x > file.txt',
    'gh release create v1',
    'cat a.ts | node -',
    'gh api -X POST repos/foo',
    'find . -name x -delete',
    'env FOO=1 rm -rf /',
    'FOO=1 rm -rf /',
    'echo "$(whoami)"',
    'echo $(whoami)',
    'sed -i s/a/b/ f.ts',
    'sed --in-place s/a/b/ f.ts',
    'awk -i inplace 1 f.ts',
    'bash -c "rm x"',
    'node --check x.mjs',
    'ls & rm x',
    'ls\nrm -rf x',
    // A backslash-escaped quote does not open a quoted span, so the mask must not treat
    // the text after it as quoted — `rm` and the substitution below both really run.
    'echo \\" ; rm x ; echo \\"',
    "echo \\' ; rm x ; echo \\'",
    "echo \\'$(whoami)\\'",
    'gh api -XPOST repos/x',
    'gh api --method=POST repos/x',
    'gh api -ftitle=x repos/x',
    'sort -o out.txt in.txt',
    'sort --compress-program=sh in.txt',
    'tree -o out.txt',
    'git diff --output=out.patch',
    'find . -fls out.txt',
    'find . -fprintf out.txt %p',
    'rg --pre cat x',
    'sudo ls',
    'tee f',
    'xargs rm',
    'eval ls',
  ];
  for (const cmd of denied) assert.equal(decision(envHook(GATE, rootBash(cmd), cfg)), 'deny', cmd);
  // A checkout operand that names an existing file is a pathspec, so it is resolved against
  // the session cwd rather than read as a branch.
  const pathspec = { ...rootBash('git checkout HEAD~1 manifest.mjs'), cwd: ROOT };
  assert.equal(decision(envHook(GATE, pathspec, cfg)), 'deny');
});

const PROBE = path.join(ROOT, 'hooks', 'payload-probe.mjs');

test('payload probe appends what the gate would read, and marks a payload it cannot parse', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-probe-'));
  homes.push(dir);
  const log = path.join(dir, 'probe.log');
  const probe = (input) => execFileSync(process.execPath, [PROBE, log], { input, encoding: 'utf8' });

  assert.equal(probe(JSON.stringify({ agent_id: 'sub-1', agent_type: 'general-purpose', ...rootBash('echo consig-sub-probe') })), '');
  assert.equal(probe('not json'), '');

  const records = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(records, [
    { agent_id: 'sub-1', agent_type: 'general-purpose', tool_name: 'Bash', command: 'echo consig-sub-probe' },
    { parse_error: true },
  ]);
});

test('gate denies a payload it cannot parse', () => {
  const out = execFileSync(process.execPath, [GATE], {
    input: 'not json', encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgFixture() },
  });
  assert.equal(decision(out), 'deny');
  assert.match(JSON.parse(out).hookSpecificOutput.permissionDecisionReason, /could not parse/i);
});

const UPDATE = path.join(ROOT, 'hooks', 'update-check.mjs');

// The hook reads one fixed path, so a HOME override is the only way to isolate it.
function update(state, env = {}, payload = { source: 'startup' }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-update-'));
  homes.push(home);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  if (state) fs.writeFileSync(path.join(home, '.claude', '.consigliere-state.json'), JSON.stringify(state));
  // The opt-outs are cleared from the inherited env, not merged into it: this suite runs
  // on a machine whose own settings.json sets CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC.
  const base = { ...process.env, HOME: home, USERPROFILE: home };
  delete base.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  delete base.CONSIGLIERE_NO_UPDATE_CHECK;
  // The hook resolves its state file through CLAUDE_CONFIG_DIR now, so an inherited one
  // would send it to the author's real install instead of this fixture.
  delete base.CLAUDE_CONFIG_DIR;
  const out = execFileSync(process.execPath, [UPDATE], {
    // a string payload goes to stdin verbatim, which is how the unparseable case is staged
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', env: { ...base, ...env },
  });
  return { out, state: JSON.parse(fs.readFileSync(path.join(home, '.claude', '.consigliere-state.json'), 'utf8')) };
}

test('update check announces a newer tag and stays quiet otherwise', () => {
  const fresh = () => Date.now();
  assert.match(update({ version: 'v1.0.0', latest: 'v1.2.0', repo: '/x', checkedAt: fresh() }).out, /v1\.2\.0 is available/);
  assert.equal(update({ version: 'v1.2.0', latest: 'v1.2.0', repo: '/x', checkedAt: fresh() }).out, '');
  // A tag that predates the installed one must not read as an update.
  assert.equal(update({ version: 'v1.2.0', latest: 'v1.0.0', repo: '/x', checkedAt: fresh() }).out, '');
  // The repo carries a `v1-sol` tag from an older era; it is unsortable on purpose.
  assert.equal(update({ version: 'v1.0.0', latest: 'v1-sol', repo: '/x', checkedAt: fresh() }).out, '');
  // 10.0.0 beats 9.0.0 — the reason this compares numbers rather than strings.
  assert.match(update({ version: 'v9.0.0', latest: 'v10.0.0', repo: '/x', checkedAt: fresh() }).out, /v10\.0\.0 is available/);
  // install.mjs records VERSION without the `v` that the tags carry.
  assert.match(update({ version: '1.0.0', latest: 'v1.1.0', repo: '/x', checkedAt: fresh() }).out, /v1\.1\.0 is available/);
  assert.equal(update({ version: '1.1.0', latest: 'v1.1.0', repo: '/x', checkedAt: fresh() }).out, '');
});

// The probe's verdict is only about the build it ran against, so a newer Claude Code makes it
// stale — and nothing else in a session would say so.
test('update check reports a Claude Code installed since the gate probe ran', () => {
  const probe = { at: '2026-01-01T00:00:00.000Z', claudeVersion: '2.1.263 (Claude Code)' };
  const base = { version: '1.0.0', repo: '/x', checkedAt: Date.now(), probe };

  const drifted = update({ ...base, claudeVersion: '2.2.0 (Claude Code)' }).out;
  assert.match(JSON.parse(drifted).systemMessage, /Claude Code 2\.2\.0 \(Claude Code\) installed since the gate probe ran on 2\.1\.263 \(Claude Code\)/);

  assert.equal(update({ ...base, claudeVersion: probe.claudeVersion }).out, '', 'the same build needs no re-probe');
  assert.equal(update({ ...base, claudeVersion: '2.2.0 (Claude Code)', probe: undefined }).out, '', 'a probe that never ran is the doctor\'s warning, not a session banner');
});

// The child asks for the version the probe verdict is about. It merges into a state file it
// re-read, so a file removed meanwhile must not come back holding only a version string.
test('the update-check child records the Claude Code version onto a state file that is still there', { skip: process.platform === 'win32' && 'the stub on PATH is a shell script' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-update-'));
  homes.push(home);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho "9.9.9 (Claude Code)"\n');
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const statePath = path.join(home, '.claude', '.consigliere-state.json');
  // No repo key, so the child never reaches `git ls-remote`.
  const child = () => execFileSync(process.execPath, [UPDATE, '--child'], {
    encoding: 'utf8', env: { PATH: bin, HOME: home, USERPROFILE: home },
  });

  child();
  assert.equal(fs.existsSync(statePath), false, 'a read that found nothing must not become a write');

  fs.writeFileSync(statePath, JSON.stringify({ version: '1.0.0' }));
  child();
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.claudeVersion, '9.9.9 (Claude Code)');
  assert.equal(state.version, '1.0.0', 'the rest of the state file survives the write');
});

// Only the user can run the command, so the notice has to reach the user directly rather
// than through the model — and a user-visible line must not reappear inside a session it
// has already interrupted once.
test('update check speaks to the user, and only when the session is a new one', () => {
  const newer = { version: 'v1.0.0', latest: 'v1.2.0', repo: '/x', checkedAt: Date.now() };

  const out = JSON.parse(update(newer).out);
  assert.match(out.systemMessage, /Run \/consig-upgrade\./);
  assert.equal(out.hookSpecificOutput, undefined, 'nothing goes to the model any more');

  assert.match(update(newer, {}, { source: 'clear' }).out, /consig-upgrade/, '/clear starts a fresh context');
  assert.match(update(newer, {}, '').out, /consig-upgrade/, 'a payload it cannot read still shows the notice');
  for (const source of ['resume', 'fork', 'compact']) {
    assert.equal(update(newer, {}, { source }).out, '', `${source} continues a session that already saw it`);
  }
});

test('update check stamps the clock itself, so a failing check still waits out the day', () => {
  // If only a successful fetch advanced checkedAt, an offline machine would spawn a
  // doomed child on every single session.
  const { state } = update({ version: 'v1.0.0', repo: '/nonexistent', checkedAt: 0 });
  assert.ok(Date.now() - state.checkedAt < 60_000);
});

test('update check stands down when it is told to, or has nothing to compare', () => {
  const stale = { version: 'v1.0.0', latest: 'v2.0.0', repo: '/x', checkedAt: 0 };
  assert.equal(update(stale, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }).out, '');
  assert.equal(update(stale, { CONSIGLIERE_NO_UPDATE_CHECK: '1' }).out, '');
  assert.equal(update({ latest: 'v2.0.0', repo: '/x' }).out, '', 'no recorded version means nothing to compare');
});

// Self-gated on rules/communication.md like the other two, so the cases below have to
// supply it — inheriting the author's own config dir would pass here and fail in CI.
let LANG_CFG;
const lang = (command) => envHook(LANG, { tool_name: 'Bash', tool_input: { command } }, (LANG_CFG ??= cfgFixture()));
const blocked = (command) => lang(command) !== '';

test('language gate stands down without rules/communication.md', () => {
  const cfg = cfgFixture({ communication: false });
  const turkish = 'git commit -m "fix: rapor sayfası artık doğru toplamı gösteriyor"';
  assert.equal(envHook(LANG, { tool_name: 'Bash', tool_input: { command: turkish } }, cfg), '');
});

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
  assert.ok(blocked('git -C /Users/x/proj tag -a v1.2.0 -m "sürüm notları ve düzeltmeler burada"'));
  // A tag command with nothing to score exits before the language pass.
  assert.equal(lang('git tag v1.2.0'), '');
});

test('language gate ignores commands that are not a commit or a PR', () => {
  assert.equal(lang('git log --oneline -m 5'), '');
  assert.equal(lang('echo "bu bir türkçe cümledir ve engellenmemeli"'), '');
});

const DISCIPLINE = path.join(ROOT, 'hooks', 'git-discipline.mjs');
const RATIO = path.join(ROOT, 'hooks', 'comment-ratio.mjs');

// These hooks self-gate on the rule file each enforces, so every case points
// CLAUDE_CONFIG_DIR at a fixture carrying exactly the files it needs.
function cfgFixture({ workflow = true, discipline = true, clean = true, communication = true, orchestrator = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-cfg-'));
  homes.push(dir);
  fs.mkdirSync(path.join(dir, 'rules'), { recursive: true });
  if (orchestrator) fs.writeFileSync(path.join(dir, 'rules', 'orchestrator.md'), '');
  if (workflow) fs.writeFileSync(path.join(dir, 'rules', 'workflow.md'), '');
  if (discipline) fs.writeFileSync(path.join(dir, 'rules', 'coding-discipline.md'), '');
  if (communication) fs.writeFileSync(path.join(dir, 'rules', 'communication.md'), '');
  if (clean) {
    fs.mkdirSync(path.join(dir, 'skills', 'clean'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', 'clean', 'SKILL.md'), '');
  }
  return dir;
}

function repo(branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-repo-'));
  homes.push(dir);
  execFileSync('git', ['init', '-q', '-b', branch, dir]);
  return dir;
}

function envHook(script, payload, cfg) {
  return execFileSync(process.execPath, [script], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
  });
}

const denyReason = (out) => JSON.parse(out).hookSpecificOutput.permissionDecisionReason;
const bash = (sid, cwd, command) => ({ tool_name: 'Bash', session_id: sid, cwd, tool_input: { command } });

test('discipline gate blocks a commit on the default branch, allows one on a task branch', () => {
  const cfg = cfgFixture();
  const main = repo('main');
  const out = envHook(DISCIPLINE, bash(session('br-main'), main, 'git commit -m "feat: add x"'), cfg);
  assert.match(denyReason(out), /BRANCH GATE/);
  const feat = repo('feat/thing');
  assert.equal(envHook(DISCIPLINE, bash(session('br-feat'), feat, 'git commit -m "feat: add the thing"'), cfg), '');
});

test('discipline gate follows -C and a cd chain to the repo the commit actually hits', () => {
  const cfg = cfgFixture();
  const master = repo('master');
  const elsewhere = repo('feat/safe');
  const cSid = session('br-dash-c');
  assert.match(denyReason(envHook(DISCIPLINE, bash(cSid, elsewhere, `git -C ${master} commit -m "feat: x"`), cfg)), /BRANCH GATE/);
  const cdSid = session('br-cd');
  assert.match(denyReason(envHook(DISCIPLINE, bash(cdSid, elsewhere, `cd ${master} && git commit -m "feat: x"`), cfg)), /BRANCH GATE/);
});

test('discipline gate blocks a non-conventional subject and passes the conventional set', () => {
  const cfg = cfgFixture();
  const feat = repo('feat/x');
  const run = (n, msg) => envHook(DISCIPLINE, bash(session(`subject-${n}`), feat, `git commit -m "${msg}"`), cfg);
  assert.match(denyReason(run('bad', 'added the export button')), /SUBJECT GATE/);
  const ok = [
    'feat: add the export button', 'fix(api)!: guard the missing id',
    'Merge branch feat/x', 'Revert feat: add the export button', 'fixup! feat: add x',
  ];
  ok.forEach((s, i) => assert.equal(run(`ok-${i}`, s), '', s));
});

test('discipline gate fails open on what it cannot read', () => {
  const cfg = cfgFixture();
  const main = repo('main');
  const feat = repo('feat/x');
  // detached/no-repo, interactive commit, a subject the shell still expands
  assert.equal(envHook(DISCIPLINE, bash(session('open-norepo'), os.tmpdir(), 'git commit -m "feat: x"'), cfg), '');
  assert.match(denyReason(envHook(DISCIPLINE, bash(session('open-branch'), main, 'git commit'), cfg)), /BRANCH GATE/);
  assert.equal(envHook(DISCIPLINE, bash(session('open-interactive'), feat, 'git commit'), cfg), '');
  assert.equal(envHook(DISCIPLINE, bash(session('open-expand'), feat, 'git commit -m "$(generate-subject)"'), cfg), '');
});

test('discipline gate ignores commands that merely mention git in prose', () => {
  // The bug this covers: a PR body whose heredoc prose says `git commit` matched the
  // unanchored regex, and the heredoc's first line was read as the commit subject.
  const cfg = cfgFixture();
  const sid = session('prose');
  fs.writeFileSync(handoffPath(sid), '');
  const body = `gh pr edit 1 --body "$(cat <<'EOF'\n## Summary\ndenies a git commit aimed at main and a gh pr create before the chain ran\nEOF\n)"`;
  assert.equal(envHook(DISCIPLINE, bash(sid, repo('main'), body), cfg), '');
  assert.equal(envHook(DISCIPLINE, bash(session('prose-log'), repo('main'), 'git log --grep "git commit"'), cfg), '');
});

test('discipline gate reads only the message of the commit itself, not an earlier command', () => {
  const cfg = cfgFixture();
  const feat = repo('feat/x');
  assert.equal(envHook(DISCIPLINE, bash(session('prior-quote'), feat, 'echo "not a subject" && git commit -m "feat: add x"'), cfg), '');
});

test('discipline gate stands down without rules/workflow.md', () => {
  const cfg = cfgFixture({ workflow: false });
  const main = repo('main');
  assert.equal(envHook(DISCIPLINE, bash(session('nogate'), main, 'git commit -m "whatever"'), cfg), '');
});

test('handoff gate denies a PR until a chain skill has run', () => {
  const cfg = cfgFixture();
  const sid = session('handoff-skill');
  const pr = bash(sid, repo('feat/x'), 'gh pr create --draft --title "feat: x" --body "body"');
  assert.match(denyReason(envHook(DISCIPLINE, pr, cfg)), /HANDOFF GATE/);
  // A pre-chain skill must not open the gate a step early.
  envHook(DISCIPLINE, { tool_name: 'Skill', session_id: sid, tool_input: { skill: 'optimize' } }, cfg);
  assert.match(denyReason(envHook(DISCIPLINE, pr, cfg)), /HANDOFF GATE/);
  // The payload shape a model-invoked skill actually carries, per live transcripts.
  envHook(DISCIPLINE, { tool_name: 'Skill', session_id: sid, tool_input: { skill: 'clean' } }, cfg);
  assert.equal(envHook(DISCIPLINE, pr, cfg), '');
});

test('a user-typed slash command opens the handoff gate too', () => {
  const cfg = cfgFixture();
  const sid = session('handoff-typed');
  const pr = bash(sid, repo('feat/x'), 'gh pr create --fill');
  assert.match(denyReason(envHook(DISCIPLINE, pr, cfg)), /HANDOFF GATE/);
  // A typed slash reaches hooks only as a UserPromptSubmit prompt, never as a Skill call.
  envHook(DISCIPLINE, { session_id: sid, prompt: '<command-name>/pr-update</command-name>\n<command-args></command-args>' }, cfg);
  assert.equal(envHook(DISCIPLINE, pr, cfg), '');
});

test('/cpr opens the handoff gate', () => {
  const cfg = cfgFixture();
  const sid = session('handoff-cpr');
  const pr = bash(sid, repo('feat/x'), 'gh pr create --fill');
  assert.match(denyReason(envHook(DISCIPLINE, pr, cfg)), /HANDOFF GATE/);
  envHook(DISCIPLINE, { tool_name: 'Skill', session_id: sid, tool_input: { skill: 'cpr' } }, cfg);
  assert.equal(envHook(DISCIPLINE, pr, cfg), '');
});

test('a prompt that merely mentions /clean does not open the handoff gate', () => {
  const cfg = cfgFixture();
  const sid = session('handoff-mention');
  envHook(DISCIPLINE, { session_id: sid, prompt: '/clean' }, cfg);
  assert.equal(fs.existsSync(handoffPath(sid)), true, 'a bare leading slash command does mark');
  const sid2 = session('handoff-mid');
  envHook(DISCIPLINE, { session_id: sid2, prompt: 'why did /clean not run earlier?' }, cfg);
  assert.equal(fs.existsSync(handoffPath(sid2)), false, 'a mid-sentence mention is not a command');
});

test('handoff gate stands down when the clean skill is not installed', () => {
  const cfg = cfgFixture({ clean: false });
  assert.equal(envHook(DISCIPLINE, bash(session('handoff-noskill'), repo('feat/x'), 'gh pr create --fill'), cfg), '');
});

// The bug this covers: the flag was written once and never cleared, so the first /clean of a
// session opened the gate for every PR after it — nine, in the transcript that prompted this.
test('a new task prompt re-arms the handoff gate, an approval does not', () => {
  const cfg = cfgFixture();
  const sid = session('handoff-rearm');
  const pr = bash(sid, repo('feat/x'), 'gh pr create --fill');
  envHook(DISCIPLINE, { session_id: sid, prompt: '/clean' }, cfg);
  assert.equal(envHook(DISCIPLINE, pr, cfg), '', 'the chain opened it');
  envHook(DISCIPLINE, { session_id: sid, prompt: '  devam \n' }, cfg);
  assert.equal(envHook(DISCIPLINE, pr, cfg), '', 'an approval continues the same task, padding included');
  envHook(DISCIPLINE, { session_id: sid, prompt: 'now add the export button to the toolbar' }, cfg);
  assert.match(denyReason(envHook(DISCIPLINE, pr, cfg)), /HANDOFF GATE/, 'a new task re-arms');
});

// The rules put the full suite in the background before a handoff, so its notification lands
// between /clean and gh pr create. Re-arming on it would deny the PR its own chain prepared.
test('a subagent notification does not re-arm the handoff gate', () => {
  const cfg = cfgFixture();
  const pr = (sid) => bash(sid, repo('feat/x'), 'gh pr create --fill');
  const shapes = [
    '[SYSTEM NOTIFICATION - NOT USER INPUT] the background job exited',
    '<task-notification>\n<task-id>bubvqt1pj</task-id>\n<status>completed</status>\n</task-notification>',
    '<agent-message teammate_id="reviewer" from="reviewer">SHIP</agent-message>',
  ];
  for (const prompt of shapes) {
    const sid = session(`handoff-notify-${shapes.indexOf(prompt)}`);
    envHook(DISCIPLINE, { session_id: sid, prompt: '/clean' }, cfg);
    envHook(DISCIPLINE, { session_id: sid, prompt }, cfg);
    assert.equal(envHook(DISCIPLINE, pr(sid), cfg), '', prompt.slice(0, 24));
  }
});

// One chain per PR. Cleared on the Post event so a denied or failed create keeps the chain.
test('the handoff gate re-arms once the PR has actually opened', () => {
  const cfg = cfgFixture();
  const sid = session('handoff-perpr');
  const pr = bash(sid, repo('feat/x'), 'gh pr create --fill');
  envHook(DISCIPLINE, { session_id: sid, prompt: '/clean' }, cfg);
  assert.equal(envHook(DISCIPLINE, pr, cfg), '');
  envHook(DISCIPLINE, { ...pr, hook_event_name: 'PostToolUse', tool_response: { exit_code: 1 } }, cfg);
  assert.equal(envHook(DISCIPLINE, pr, cfg), '', 'a create that failed keeps the chain');
  envHook(DISCIPLINE, { ...pr, hook_event_name: 'PostToolUse' }, cfg);
  assert.match(denyReason(envHook(DISCIPLINE, pr, cfg)), /HANDOFF GATE/);
});

// The root opens the PR itself, so one payload has to clear both hooks.
test('a root gh pr create after /clean passes the gate and the discipline hook', () => {
  const cfg = cfgFixture();
  const sid = session('handoff-root');
  const pr = bash(sid, repo('feat/x'), 'gh pr create --fill');
  envHook(DISCIPLINE, { session_id: sid, prompt: '/clean' }, cfg);
  assert.equal(envHook(GATE, pr, cfg), '');
  assert.equal(envHook(DISCIPLINE, pr, cfg), '');
});

test('force gate denies a bare --force and passes the leased forms', () => {
  const cfg = cfgFixture();
  const feat = repo('feat/x');
  const run = (n, c) => envHook(DISCIPLINE, bash(session(`force-${n}`), feat, c), cfg);
  assert.match(denyReason(run('bare', 'git push --force origin feat/x')), /FORCE GATE/);
  assert.match(denyReason(run('short', 'git push -f origin feat/x')), /FORCE GATE/);
  assert.match(denyReason(run('cluster', 'git push -uf origin feat/x')), /FORCE GATE/);
  assert.equal(run('lease', 'git push --force-with-lease origin feat/x'), '');
  assert.equal(run('includes', 'git push --force-if-includes origin feat/x'), '');
  assert.equal(run('plain', 'git push -u origin feat/x'), '');
});

test('wait gate denies sleep polling and an inflated timeout', () => {
  const cfg = cfgFixture();
  const feat = repo('feat/x');
  const run = (n, c, extra) => envHook(DISCIPLINE,
    { ...bash(session(`wait-${n}`), feat, c), tool_input: { command: c, ...extra } }, cfg);
  assert.match(denyReason(run('sleep', 'sleep 30 && cat /tmp/out.log')), /WAIT GATE/);
  assert.match(denyReason(run('timeout', 'npm run build', { timeout: 600000 })), /WAIT GATE/);
  assert.equal(run('default', 'npm run build', { timeout: 120000 }), '');
  assert.equal(run('nan', 'npm run build', { timeout: 'later' }), '');
  assert.equal(run('word', 'echo "sleep on it"'), '', 'sleep inside a quoted string is prose');
});

test('verifier gate denies a filtered verifier and leaves other pipelines alone', () => {
  const cfg = cfgFixture();
  const feat = repo('feat/x');
  const run = (n, c) => envHook(DISCIPLINE, bash(session(`filter-${n}`), feat, c), cfg);
  assert.match(denyReason(run('npm', 'npm test | tail -20')), /VERIFIER GATE/);
  assert.match(denyReason(run('npx', 'npx jest src/ | grep -i fail')), /VERIFIER GATE/);
  assert.match(denyReason(run('node', 'node --test tests/hooks.test.mjs | head -40')), /VERIFIER GATE/);
  assert.equal(run('redirect', 'npm test > /tmp/t.log 2>&1; echo "exit=$?"'), '');
  // A verifier and an unrelated filter in one command are two segments, not a filtered run.
  assert.equal(run('split', 'npm test > /tmp/t.log 2>&1; git log --oneline | head -5'), '');
  assert.equal(run('other', 'gh pr view 12 | tail -5'), '', 'gh is not a verifier');
});

// The reported failure is that the rules go missing after a long conversation, and compact
// and resume are the two events that rebuild one from a summary.
test('session start re-states the rules only where the context was rebuilt', () => {
  const cfg = cfgFixture();
  const start = (source) => envHook(DISCIPLINE, { hook_event_name: 'SessionStart', source }, cfg);
  for (const source of ['compact', 'resume']) {
    const out = JSON.parse(start(source)).hookSpecificOutput;
    assert.equal(out.hookEventName, 'SessionStart', source);
    assert.match(out.additionalContext, /one review at most → \/cpr/, source);
  }
  for (const source of ['startup', 'clear']) assert.equal(start(source), '', source);
  assert.equal(envHook(DISCIPLINE, { hook_event_name: 'SessionStart', source: 'compact' },
    cfgFixture({ workflow: false })), '', 'still self-gated on the rule it re-states');
});

const ratio = (cfg, file, tool_input) => envHook(RATIO, { tool_input: { file_path: file, ...tool_input } }, cfg);
const HEAVY = '// what this does\n// and how\n// and when\nconst x = 1;\nconst y = 2;\n';

test('comment ratio nudges a comment-heavy edit', () => {
  const cfg = cfgFixture();
  const out = JSON.parse(ratio(cfg, '/x/proj/a.ts', { content: HEAVY }));
  assert.match(out.hookSpecificOutput.additionalContext, /COMMENT BUDGET: this edit landed 3 comment lines against 2/);
  // Edit and MultiEdit carry the text under different keys.
  assert.match(ratio(cfg, '/x/proj/a.ts', { new_string: HEAVY }), /COMMENT BUDGET/);
  assert.match(ratio(cfg, '/x/proj/a.py', { edits: [{ new_string: '# a\n# b\n# c\nx = 1\ny = 2\n' }] }), /COMMENT BUDGET/);
});

test('comment ratio stays silent below the bar', () => {
  const cfg = cfgFixture();
  assert.equal(ratio(cfg, '/x/proj/a.ts', { content: 'const a = 1;\nconst b = 2;\n// why: guards the id\nconst c = 3;\nconst d = 4;\n' }), '', 'code-heavy');
  assert.equal(ratio(cfg, '/x/proj/a.ts', { content: '// a\n// b\n// c\n' }), '', 'a deliberate comment insert is below the size floor');
  assert.equal(ratio(cfg, '/x/proj/notes.md', { content: HEAVY }), '', 'not a code file');
  assert.equal(ratio(cfg, '/x/proj/a.py', { content: '#!/usr/bin/env python\nx = 1\n' }), '', 'a shebang is not a comment');
  assert.equal(ratio(cfg, '/x/proj/a.c', { content: 'int f() {\n*p = x;\n*q = y;\n*r = z;\nreturn 0;\n}\n' }), '', 'C dereferences are not comments');
  assert.equal(ratio(cfgFixture({ discipline: false }), '/x/proj/a.ts', { content: HEAVY }), '', 'no rule file, no nudge');
});

// Every ExitPlanMode fixture below is fabricated: no transcript on any machine here holds
// a real one. The plan_mode attachment literal is not — it is copied from live sessions.
const CAPTURE = path.join(ROOT, 'hooks', 'plan-capture.mjs');

const PLAN_BODY = '# The plan\n\n## Status\n\n- **Priority**: P2\n- **Effort**: M\n- **Depends on**: none\n\nbody\n';

function planFixture({ target = 'plans', gitFile = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consigliere-plan-'));
  homes.push(dir);
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  if (gitFile) fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /elsewhere\n');
  else fs.mkdirSync(path.join(repo, '.git'));
  for (const name of [].concat(target || [])) fs.mkdirSync(path.join(repo, name));
  const plan = path.join(dir, 'inherited-kitten.md');
  fs.writeFileSync(plan, PLAN_BODY);
  const captured = (name = 'plans') => path.join(repo, name);
  const plans = (name) => fs.readdirSync(captured(name)).filter((f) => f !== 'README.md');
  const index = (name) => fs.readFileSync(path.join(captured(name), 'README.md'), 'utf8');
  return { dir, repo, plan, captured, plans, index };
}

function transcript(dir, lines) {
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

const attachment = (planFilePath) =>
  JSON.stringify({ type: 'attachment', attachment: { type: 'plan_mode', reminderType: 'full', planFilePath } });

// stderr is the hook's only channel and would otherwise land in the test output.
function capture(payload) {
  execFileSync(process.execPath, [CAPTURE], { input: JSON.stringify(payload), stdio: ['pipe', 'pipe', 'pipe'] });
}

test('an approved plan lands in plans/ as a numbered, indexed /improve plan', () => {
  const f = planFixture();
  capture({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
  assert.deepEqual(f.plans(), ['001-inherited-kitten.md']);
  assert.equal(
    fs.readFileSync(path.join(f.captured(), '001-inherited-kitten.md'), 'utf8'),
    PLAN_BODY.replace('# The plan', '# Plan 001: The plan'),
  );
  assert.match(f.index(), /^\| 001 \| The plan \| P2 \| M \| none \| TODO \|$/m);
});

// The numbering is the whole point of landing in plans/: an /improve plan and a captured
// one share the sequence, so improve picks up where plan mode left off.
test('numbering continues after the highest plan already there', () => {
  const f = planFixture();
  fs.writeFileSync(path.join(f.captured(), '007-existing.md'), '# Existing\n');
  capture({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
  assert.ok(f.plans().includes('008-inherited-kitten.md'), f.plans().join());
});

// The slug is fixed for the whole session, so a re-plan must not overwrite the plan it
// replaces — the number, not the name, keeps them apart.
test('a second approval in one session gets the next number', () => {
  const f = planFixture();
  const t = transcript(f.dir, [attachment(f.plan)]);
  capture({ cwd: f.repo, transcript_path: t });
  capture({ cwd: f.repo, transcript_path: t });
  assert.deepEqual(f.plans().sort(), ['001-inherited-kitten.md', '002-inherited-kitten.md']);
  assert.equal(f.index().match(/^\| 00\d \|/gm).length, 2);
});

test('an existing index gets the row, and nothing else changes', () => {
  const f = planFixture();
  const readme = path.join(f.captured(), 'README.md');
  fs.writeFileSync(path.join(f.captured(), '001-old.md'), '# Old\n');
  fs.writeFileSync(readme, '# Plans\n\n| Plan | Title | Priority | Effort | Depends on | Status |\n'
    + '|------|-------|----------|--------|------------|--------|\n| 001 | Old | P1 | S | — | DONE |\n\n## Notes\n\nkeep me\n');
  capture({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
  const lines = f.index().split('\n');
  assert.equal(lines[4], '| 001 | Old | P1 | S | — | DONE |');
  assert.match(lines[5], /^\| 002 \| The plan \|/);
  assert.ok(f.index().includes('## Notes\n\nkeep me\n'));
});

// The two branches the row falls back through, and a title that would splice itself in as
// a string replacement pattern.
test('a plan without a Status block, and an index without a table', () => {
  const f = planFixture();
  fs.writeFileSync(f.plan, '# Cut $& $$ spend\n\nbody\n');
  fs.writeFileSync(path.join(f.captured(), 'README.md'), '# Plans\n\nno table here\n');
  capture({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
  assert.deepEqual(f.plans(), ['001-inherited-kitten.md']);
  assert.match(fs.readFileSync(path.join(f.captured(), '001-inherited-kitten.md'), 'utf8'),
    /^# Plan 001: Cut \$& \$\$ spend$/m);
  assert.equal(f.index(), '# Plans\n\nno table here\n');
});

test('an index the hook creates carries the status vocabulary', () => {
  const f = planFixture();
  capture({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
  assert.match(f.index(), /^Status values: TODO \| IN PROGRESS \| DONE \|/m);
});

// /improve's own escape hatch for a repo whose plans/ already means something else.
test('advisor-plans/ wins over plans/', () => {
  const f = planFixture({ target: ['plans', 'advisor-plans'] });
  capture({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
  assert.deepEqual(f.plans('advisor-plans'), ['001-inherited-kitten.md']);
  assert.deepEqual(f.plans(), []);
});

// Requiring the directory up front was the earlier design, and it dropped plans in silence.
test('a repo with no plans/ gets one', () => {
  const f = planFixture({ target: null });
  capture({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
  assert.deepEqual(f.plans(), ['001-inherited-kitten.md']);
  assert.deepEqual(fs.readdirSync(f.repo).sort(), ['.git', 'plans']);
});

test('advisor-plans/ alone is enough; plans/ is not created beside it', () => {
  const f = planFixture({ target: 'advisor-plans' });
  capture({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
  assert.deepEqual(f.plans('advisor-plans'), ['001-inherited-kitten.md']);
  assert.deepEqual(fs.readdirSync(f.repo).sort(), ['.git', 'advisor-plans']);
});

// Outside a repo there is no root to create anything at, so the walk must give up rather
// than dropping a plans/ wherever the session happened to start.
test('no repo root means nothing is written', () => {
  const f = planFixture({ target: null });
  fs.rmSync(path.join(f.repo, '.git'), { recursive: true, force: true });
  capture({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
  assert.deepEqual(fs.readdirSync(f.repo), []);
});

// Plan mode routinely starts in a package dir, and cwd alone would scatter plans through
// a monorepo instead of collecting them at the root.
test('the repo root is found from a subdirectory, worktrees included', () => {
  for (const gitFile of [false, true]) {
    const f = planFixture({ gitFile });
    const deep = path.join(f.repo, 'packages', 'api', 'src');
    fs.mkdirSync(deep, { recursive: true });
    capture({ cwd: deep, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
    assert.equal(f.plans().length, 1, gitFile ? '.git file' : '.git dir');
  }
});

// A session can enter plan mode more than once; the approval belongs to the newest.
test('the last plan_mode attachment wins, and junk lines do not stop the scan', () => {
  const f = planFixture();
  const stale = path.join(f.dir, 'stale.md');
  fs.writeFileSync(stale, 'old\n');
  capture({
    cwd: f.repo,
    transcript_path: transcript(f.dir, [attachment(stale), '{"type":"user"}', '{not json', attachment(f.plan), '']),
  });
  assert.deepEqual(f.plans(), ['001-inherited-kitten.md']);
});

test('a hook that cannot capture stays silent', () => {
  const cases = {
    'no attachment': (f) => ({ cwd: f.repo, transcript_path: transcript(f.dir, ['{"type":"user"}']) }),
    'plan file gone': (f) => ({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(path.join(f.dir, 'nope.md'))]) }),
    'no transcript_path': (f) => ({ cwd: f.repo }),
    'transcript unreadable': (f) => ({ cwd: f.repo, transcript_path: path.join(f.dir, 'missing.jsonl') }),
    'not a repo': (f) => ({ cwd: f.dir, transcript_path: transcript(f.dir, [attachment(f.plan)]) }),
  };
  // target: null throughout, so the assertion is that the tree is byte-for-byte unchanged —
  // the directory is created at write time, not when the walk finds a root.
  for (const [name, build] of Object.entries(cases)) {
    const f = planFixture({ target: null });
    capture(build(f));
    assert.deepEqual(fs.readdirSync(f.repo), ['.git'], name);
  }
  // A repo where `plans` is a regular file: the gate must reject it, not crash on readdir.
  const f = planFixture({ target: null });
  fs.writeFileSync(path.join(f.repo, 'plans'), 'not a directory\n');
  capture({ cwd: f.repo, transcript_path: transcript(f.dir, [attachment(f.plan)]) });
  assert.deepEqual(fs.readdirSync(f.repo).sort(), ['.git', 'plans']);
  assert.equal(fs.readFileSync(path.join(f.repo, 'plans'), 'utf8'), 'not a directory\n');
});

