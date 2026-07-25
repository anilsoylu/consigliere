#!/usr/bin/env node
// UserPromptSubmit hook: (1) resets the advisor gate flag on a NEW task prompt
// (kept on short approval messages so Execute can proceed), (2) emits the loop
// directive ONLY when the prompt carries a code/design signal. Firing on every
// turn — including "how much does X cost" — trains the loop to tune it out, so
// silence on unrelated prompts is what gives the directive its weight.
import fs from 'node:fs';
let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
const sid = payload.session_id || 'default';
const prompt = (payload.prompt || '').trim();
const flag = `/tmp/advisor-gate-${sid}.flag`;

// Only a SHORT standalone ack counts as approval. "Okay, now fix this unrelated bug"
// starts with an approval word but carries a new task — it must reset the flag.
const isApproval =
  prompt.length <= 24 &&
  /^(onayl|onay|evet|devam|tamam|olur|approve|ok\b|okay\b|go\b|yes\b|proceed)/i.test(prompt);
if (!isApproval) {
  try { fs.rmSync(flag, { force: true }); } catch {}
}

// An explicit request always wins, regardless of what else the prompt says.
const onDemand = /dan[ıi]ş|consult sol|sol'?a sor|ask sol/i.test(prompt);

// Otherwise: does this prompt plausibly end in a source-code edit? Config, markdown
// and questions deliberately miss — advisor-executor.md routes those straight to the
// executor. Turkish is agglutinative, so match stems and accept the slack.
const CODE_SIGNAL = new RegExp([
  '\\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|c|h|cpp|hpp|cc|vue|svelte|sql|sh)\\b',
  '/(code-review|apple-design|improve|quality-code|software-architecture-design|systematic-debugging)\\b',
  '\\b(implement|refactor|debug|crash|failing|regression|endpoint|schema|migration|architecture)\\b',
  '\\b(fix|bug|api|component|function|query|deploy|optimi[sz]e|design)\\b',
  '\\btest',
  '(hata|düzelt|mimari|tasarla|tasarım|özellik|fonksiyon|bileşen|sorgu|entegre|kodla|geliştir|çalışmıyor|patlıyor|bozuldu)',
].join('|'), 'i');

if (!onDemand && !CODE_SIGNAL.test(prompt)) process.exit(0);

process.stdout.write(
  'ADVISOR/EXECUTOR LOOP — this prompt carries a code/design signal.\n' +
  '1) PLAN via Sol. This is the only entry point; do not spawn a subagent for it:\n' +
  '   bash ~/.claude/hooks/advisor-watchdog.sh "<task>. Do NOT web-search; mark external needs as \'RESEARCH NEEDED: <q>\'."\n' +
  '   Ground it — name the exact file, diff, or failing output. A bare one-line task wastes the call.\n' +
  '   Stalls >5 min → WATCHDOG_HUNG (exit 124); continue on Opus alone.\n' +
  '2) RESEARCH each "RESEARCH NEEDED" yourself (Sol has no web), then re-run the watchdog with the findings appended.\n' +
  '3) RELAY the plan to the user, then execute. Auto mode: do not stop for plan approval.\n' +
  '4) RE-CONSULT when the same error or verifier fails twice — stop before the third attempt and re-run with the actual output.\n' +
  '5) REVIEW critical diffs through Sol: every finding labelled [ADOPT]/[DISCUSS]/[STYLE]/[OVER-ENGINEERED], all of them relayed verbatim.\n' +
  'Sol is read-only — never pass --write. Details: ~/.claude/rules/advisor-executor.md'
);
