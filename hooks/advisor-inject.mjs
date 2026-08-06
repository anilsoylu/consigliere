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
const onDemand = /dan[ıi]ş|consult (the )?advisor|advisor'?a sor|ask the advisor/i.test(prompt);

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
  '1) PLAN via the advisor subagent — spawn it with the Agent tool, synchronously:\n' +
  '   Agent({ subagent_type: "advisor", prompt: "<consult>", run_in_background: false })\n' +
  '   The agent definition carries the advisor doctrine (verdict discipline, ~300 words) — do not retype it.\n' +
  '   Carry the five-part contract in the prompt: objective, files, evidence (actual diff/output, never a paraphrase), constraints, options considered.\n' +
  '2) RESEARCH each "RESEARCH NEEDED" yourself (the advisor has no web), then re-consult with the findings appended.\n' +
  '3) RELAY the plan to the user, then execute. Auto mode: do not stop for plan approval.\n' +
  '4) RE-CONSULT when the same error or verifier fails twice — stop before the third attempt and consult with the actual output.\n' +
  '5) FINAL REVIEW, mandatory before reporting done — the native /review skill, not the advisor:\n' +
  '   bash ~/.claude/hooks/review-tier.sh  → none|medium|high|xhigh (none = no source changes, skip).\n' +
  '   Run the built-in /review skill at that tier; high → with --fix, then re-run the verifier on the fixed diff.\n' +
  '   Escalate the tier with a stated reason if the diff warrants it; never downgrade. Relay all findings — no severity filtering.\n' +
  '   The advisor reads a diff only on demand ("danış").\n' +
  'The advisor has Read/Grep/Glob and nothing else — it cannot write code. Details: ~/.claude/rules/advisor-executor.md'
);
