#!/usr/bin/env node
// UserPromptSubmit hook: (1) resets the advisor gate flag on a NEW task prompt
// (kept on short approval messages so Execute can proceed), (2) emits a one-line
// task-boundary trigger. The full loop lives in ~/.claude/rules/advisor-executor.md
// and in advisor-gate.mjs's stderr — repeating it every turn is pure duplication.
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

process.stdout.write(
  'Source-code change or real design work → run ' +
  'bash ~/.claude/hooks/advisor-watchdog.sh "<task>" before implementation.'
);
