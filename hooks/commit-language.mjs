#!/usr/bin/env node
// PreToolUse(Bash): block `git commit`, `git tag` or `gh pr create/edit` whose message
// text is Turkish.
// rules/communication.md already requires English for everything that lands in a repo.
// The rule alone did not hold, so this enforces it at the one moment the text is still
// cheap to change — before the commit exists.
//
// Extraction never interprets shell structure. Two regexes lift heredoc bodies and
// quoted flag arguments straight out of the raw command, so `&&` chains, pipes and
// `$(cat <<'EOF')` nesting are all irrelevant. Knowing WHICH command a quoted span
// belongs to would need a shell parser; it isn't needed, because in a string that
// already contains `git commit`, such a span is either the message or harmless to score.
//
// Anything unparsed (`-F path`, `--body-file`) fails OPEN, and that is deliberate:
// a false positive blocks a commit no rewrite can unblock, which is how a hook earns
// being disabled. A false negative only leaves the status quo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Inlined rather than imported: hooks run from <config>/hooks with no manifest beside them.
function cfgDir() {
  const e = process.env.CLAUDE_CONFIG_DIR;
  if (e && e.trim() !== '') {
    return e.startsWith('~') ? path.resolve(os.homedir(), e.replace(/^~[/\\]?/, '')) : path.resolve(e);
  }
  return path.join(os.homedir(), '.claude');
}

// Self-gated like git-discipline.mjs: this package does not ship communication.md, so
// without it the hook would block Turkish text in the name of a rule you never agreed to,
// and point at a file that is not there.
const RULE = path.join(cfgDir(), 'rules', 'communication.md');
if (!fs.existsSync(RULE)) process.exit(0);

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cmd = (payload.tool_name === 'Bash' && payload.tool_input?.command) || '';
// `git -C <dir>` is routine here because the harness resets cwd between calls. Exactly one
// flag is allowed before the subcommand: `(?:-\S+\s+)*` would start matching `git log -p
// commit..`. So `git -c user.name=x commit` still fails open, like everything this cannot read.
if (!cmd || !/\bgit\s+(?:-C\s+\S+\s+)?(?:commit|tag)\b|\bgh\s+pr\s+(?:create|edit)/.test(cmd)) process.exit(0);

const parts = [];
// Heredocs come out first and are cut from the string the flag passes see. The common
// `--body "$(cat <<'EOF' … EOF)"` shape sits inside a quoted flag arg, so leaving them in
// would extract the same body twice and halve the effective threshold.
const rest = cmd.replace(/<<-?\s*['"]?(\w+)['"]?\r?\n([\s\S]*?)\r?\n[ \t]*\1\b/g, (_, __, body) => {
  parts.push(body);
  return ' ';
});
for (const m of rest.matchAll(/(?:-m|--message|--title|--body)(?:=|\s+)"((?:[^"\\]|\\.)*)"/g)) parts.push(m[1]);
for (const m of rest.matchAll(/(?:-m|--message|--title|--body)(?:=|\s+)'([^']*)'/g)) parts.push(m[1]);
if (!parts.length) process.exit(0);

// Quoted spans are exempt: per the same rule, user-facing product copy keeps the
// product's locale, so a commit body may legitimately quote Turkish UI text.
// A single quote only opens a span at a word boundary — attached to a letter it is a
// Turkish suffix apostrophe (`batch'ini`, `TWR'dan`), and treating that as a quote
// would silently swallow the sentence around it.
const text = parts.join('\n')
  .replace(/`[^`]*`/g, ' ')
  .replace(/"[^"]*"/g, ' ')
  .replace(/(^|[\s(\[])'[^']*'/gm, '$1 ');

const TR_LETTERS = /[ğşıİĞŞ]/;
const STOPWORDS = new Set(['ve', 'ile', 'için', 'icin', 'bir', 'bu', 'ama', 'sonra', 'artık', 'artik', 'mı', 'mi']);
const SUFFIX = /(leri|ları|lari|iyor|ıyor|mesin|masın|masin|alındı|alindi|acak|ecek|mış|miş|mis|sını|sini|ında|inde)$/;

// Absolute count, not a ratio: a body that mixes an English paragraph with a Turkish
// one must still block, and a ratio lets the English half dilute it away.
let score = 0;
const marks = [];
for (const token of text.split(/[^\p{L}\p{N}_']+/u)) {
  if (token.length < 2) continue;
  const low = token.toLocaleLowerCase('tr');
  if (TR_LETTERS.test(token)) { score += 2; marks.push(token); continue; }
  // Caps-only tokens are acronyms. Turkish lowercasing maps I to ı, which turns `MI` and
  // `BU` into stopwords; genuinely Turkish caps carry a diacritic and were caught above.
  if (!/[a-z]/.test(token)) continue;
  if (STOPWORDS.has(low)) { score += 2; marks.push(token); continue; }
  // Identifiers carry accidental suffixes (`headers`, `compilers`, `user_id`), so the
  // weakest signal is the one that must not fire on code.
  if (/[_\d]/.test(token) || /[a-z][A-Z]/.test(token)) continue;
  if (SUFFIX.test(low)) { score += 1; marks.push(token); }
}

if (score < 3) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      `LANGUAGE GATE: this commit or PR text reads as Turkish (${marks.slice(0, 6).join(', ')}). `
      // No mention of the quoted-span exemption: naming it here reads as instructions for
      // getting the same Turkish text through by wrapping it in quotes.
      + 'Everything that lands in a repository is English — commit subjects and bodies, PR titles and bodies. '
      + `Rewrite the message in English and run the same command again. See ${RULE}.`,
  },
}));
