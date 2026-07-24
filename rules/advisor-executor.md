# Advisor / Executor Loop

**Advisor (brain)** = Codex Sol, read-only, watchdog-wrapped. Plans and critiques, writes no code.
**Executor (hands)** = the main loop. Implements.

## Call

```
bash ~/.claude/hooks/advisor-watchdog.sh "<task>. Do NOT web-search; mark external needs as 'RESEARCH NEEDED: <q>'."
```

This is the only way to invoke the advisor. Read-only is structural, not a promise — the companion runs `task` without `--write`, so its sandbox is read-only. Never pass `--write`. Sol can still use read-only tools (git diff/blame, ripgrep) to ground itself.

The watchdog auto-cancels after 5 minutes of no progress (`WATCHDOG_HUNG`, exit 124) — when that prints, continue alone. Sol has no web access; it emits `RESEARCH NEEDED: <q>` instead. Research those yourself, then re-run the watchdog with the findings appended.

## When

Source-code changes and real design work, including `/code-review`, `/apple-design`, `/improve`. Pure questions, chat, notes, and config edits go direct.

Re-consult when the same error or verifier fails twice — stop before the third attempt and re-run the watchdog with the actual failing output. The user can also ask for a consultation at any point ("consult Sol" / "danış").

## Grounding

Sol only sees what the prompt gives it, plus its own read-only git/ripgrep. Name the exact diff, commit, or failing output. A bare one-line task when concrete context exists wastes the call.

If Sol's guidance contradicts what you observe — a recommended step fails, file contents differ from its assumption — surface the conflict to the user instead of following it blindly.

## Review output

When Sol reviews a diff (not initial planning), have it label every finding `[ADOPT]` (real bug/security/perf), `[DISCUSS]` (debatable), `[STYLE]` (preference), `[OVER-ENGINEERED]` (complexity to cut).

Relay all findings verbatim. Never silently drop one — the user decides what to apply.

## Gate

A PreToolUse hook blocks Edit/Write on real source files (`.ts .tsx .js .py .go .rs …`) until the advisor was called this task. Never gated: `~/.claude`, `~/.codex`, `/tmp`, `~/Desktop`, and any non-code file. The flag resets on each new task prompt and survives approval messages. Trivial source change → ask the user, don't fake the flag.

Advisor unreachable or watchdog cancels → continue alone. Only planning is lost.
