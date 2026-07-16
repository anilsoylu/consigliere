#!/usr/bin/env bash
# Consigliere advisor watchdog.
# Runs Codex Sol as a background job via the codex-plugin-cc companion, polls its log,
# cancels it if it stalls (no log growth), and prints the result otherwise.
#
# Usage: advisor-watchdog.sh "<prompt>" [max_idle_sec] [poll_sec]
#   max_idle_sec: cancel if the job log does not grow for this long (default 300 = 5 min)
#   poll_sec:     status/log poll interval (default 20)
#
# Exit codes: 0 = result printed | 124 = hung, cancelled | 3 = could not start | 4 = job failed
set -uo pipefail

PROMPT="${1:?prompt required}"
MAX_IDLE="${2:-300}"
POLL="${3:-20}"

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
