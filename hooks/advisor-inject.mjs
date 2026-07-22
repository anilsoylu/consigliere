#!/usr/bin/env node
// UserPromptSubmit hook: (1) resets the advisor gate flag on a NEW task prompt
// (kept on approval messages so Execute can proceed), (2) injects the loop directive.
import fs from 'node:fs';
let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
const sid = payload.session_id || 'default';
const prompt = (payload.prompt || '').trim();
const flag = `/tmp/advisor-gate-${sid}.flag`;

const isApproval = /^(onayl|onay|evet|devam|tamam|olur|approve|ok\b|okay\b|go\b|yes\b|proceed)/i.test(prompt);
if (!isApproval) {
  try { fs.rmSync(flag, { force: true }); } catch {}
}

process.stdout.write(
  "ADVISOR/EXECUTOR LOOP: For source-code changes or real design work (incl. skills /code-review /apple-design /improve): " +
  "1) PLAN via Codex Sol through the WATCHDOG wrapper: " +
  "`bash ~/.claude/hooks/advisor-watchdog.sh \"<task>. Do NOT web-search; mark external needs as 'RESEARCH NEEDED: <q>'.\"` " +
  "— it auto-cancels if Codex stalls >5min (prints WATCHDOG_HUNG → just continue on Opus alone; no 1-hour hangs). " +
  "2) If the plan contains 'RESEARCH NEEDED', research it via WebSearch/WebFetch, then re-run the watchdog with the findings appended so Sol finalizes. " +
  "3) PRESENT the plan, WAIT for approval, do NOT write code yet. " +
  "4) EXECUTE as the executor (Opus 4.8 high). " +
  "5) RE-CONSULT on a recurring error: if the same error/verifier fails twice, STOP and re-run the watchdog with the actual error output before a third attempt — don't loop the same fix blindly. " +
  "6) VERIFY — on critical changes have Sol REVIEW read-only and label every finding [ADOPT]/[DISCUSS]/[STYLE]/[OVER-ENGINEERED]; relay ALL findings to the user verbatim (zero-filter), user decides. Ground the review by naming the exact diff/error for Sol; if Sol's advice contradicts what you observe (a step fails when tried, file contents differ), surface the conflict instead of following it blindly. " +
  "Advisor is always read-only (never pass --write). " +
  "The user can request a Sol consultation at any point (\"consult Sol\"/\"danış\"), not only at plan/review. " +
  "Pure questions/chat/notes/config edits → act directly, no advisor. " +
  "Gate blocks Edit/Write on source-code files until the advisor is called; ~/.claude ~/.codex /tmp ~/Desktop and non-code files are exempt."
);
