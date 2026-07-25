#!/usr/bin/env bash
# Consigliere advisor watchdog.
# Runs Codex Sol as a background job via the codex-plugin-cc companion, polls its log,
# cancels it if it stalls (no log growth), and prints the result otherwise.
# Appends the advisor doctrine (verdict discipline + no web-search) to every prompt,
# so callers never retype it.
#
# Usage: advisor-watchdog.sh "<prompt>" [max_idle_sec] [poll_sec]
#        advisor-watchdog.sh --file <prompt_file> [max_idle_sec] [poll_sec]
#   --file:       read the prompt from a file — use for long context (diffs, failing
#                 output); avoids shell-quoting hazards
#   max_idle_sec: cancel if the job log does not grow for this long (default 300 = 5 min)
#   poll_sec:     status/log poll interval (default 20)
#
# Exit codes: 0 = result printed | 124 = hung, cancelled | 3 = could not start | 4 = job failed
set -uo pipefail

if [ "${1:-}" = "--file" ]; then
  FILE="${2:?prompt file required after --file}"
  if [ ! -f "$FILE" ]; then
    echo "WATCHDOG_ERROR: prompt file not found: $FILE" >&2
    exit 3
  fi
  PROMPT=$(cat "$FILE")
  shift 2
else
  PROMPT="${1:?prompt required}"
  shift 1
fi
MAX_IDLE="${1:-300}"
POLL="${2:-20}"

# Advisor doctrine — appended to every consult so each call is disciplined by default.
# The no-web-search rule is deliberate: Sol runs without search, and search would burn
# the Codex plan's token budget even if it worked.
DOCTRINE='

--- ADVISOR DOCTRINE (always applies) ---
- Do NOT web-search; mark external needs as "RESEARCH NEEDED: <question>".
- Give a verdict, not a survey: "Do X, not Y, because Z" — and name the single risk that decides it.
- A sound plan gets one line. Do not manufacture objections to justify being consulted.
- Name missing information precisely: what it is and what each answer would imply. No bare "it depends".
- Stay under ~300 words. Your reader is another model mid-task, not a human reading a report.'
PROMPT="${PROMPT}${DOCTRINE}"

# Resolve the companion script, robust to plugin version drift (newest version wins).
C=$(ls -dt "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | head -1)
if [ -z "$C" ] || [ ! -f "$C" ]; then
  echo "WATCHDOG_ERROR: codex-companion.mjs not found. Is the openai/codex-plugin-cc plugin installed? (run: /plugin install codex@openai-codex)" >&2
  exit 3
fi

START=$(node "$C" task --background "$PROMPT" 2>&1)
JOB=$(printf '%s' "$START" | grep -oE 'task-[a-z0-9]+-[a-z0-9]+' | head -1)
if [ -z "$JOB" ]; then
  echo "WATCHDOG_ERROR: could not start Codex job. Output: $START" >&2
  exit 3
fi
echo "WATCHDOG: started $JOB (max_idle=${MAX_IDLE}s poll=${POLL}s)" >&2

LOG=""
last_size=-1
idle=0
while :; do
  sleep "$POLL"
  ST=$(node "$C" status "$JOB" --json 2>/dev/null)
  state=$(printf '%s' "$ST" | grep -oiE '"status"[[:space:]]*:[[:space:]]*"[a-z]+"' | head -1 | grep -oiE '[a-z]+"$' | tr -d '"')
  [ -z "$LOG" ] && LOG=$(printf '%s' "$ST" | sed -n 's/.*"logFile"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

  case "$state" in
    completed|done|finished|succeeded|success)
      node "$C" result "$JOB" 2>/dev/null
      exit 0 ;;
    failed|error|errored|cancelled|canceled)
      echo "WATCHDOG_FAILED: job $JOB ended in state '$state'. Continue on Opus alone." >&2
      exit 4 ;;
  esac

  size=0
  [ -n "$LOG" ] && [ -f "$LOG" ] && size=$(wc -c < "$LOG" 2>/dev/null || echo 0)
  if [ "$size" -gt "$last_size" ]; then
    last_size=$size; idle=0
  else
    idle=$((idle + POLL))
  fi

  if [ "$idle" -ge "$MAX_IDLE" ]; then
    node "$C" cancel "$JOB" >/dev/null 2>&1
    echo "WATCHDOG_HUNG: job $JOB stalled for ${MAX_IDLE}s (no log growth); cancelled. Continue on Opus alone." >&2
    exit 124
  fi
done
