# Advisor / Executor Loop

**Advisor (brain)** = Codex Sol, read-only, watchdog-wrapped. Plans and critiques, writes no code.
**Executor (hands)** = the main loop. Implements.

## Call

```
bash ~/.claude/hooks/advisor-watchdog.sh "<consult>"
bash ~/.claude/hooks/advisor-watchdog.sh --file <prompt-file>   # long context: diffs, failing output
```

This is the only way to invoke the advisor. The watchdog appends the advisor doctrine (verdict-not-survey, no manufactured objections, ~300-word cap, no web-search) to every prompt — never retype it. For anything longer than a few lines, write the consult to a temp file and use `--file`; inlining diffs into shell quotes corrupts prompts.

Read-only is structural, not a promise — the companion runs `task` without `--write`, so its sandbox is read-only. Never pass `--write`. Sol can still use read-only tools (git diff/blame, ripgrep) to ground itself.

The watchdog auto-cancels after 5 minutes of no progress (`WATCHDOG_HUNG`, exit 124) — when that prints, continue alone. Sol has no web access; it emits `RESEARCH NEEDED: <q>` instead. Research those yourself, then re-run the watchdog with the findings appended.

## When

Source-code changes and real design work, including `/code-review`, `/apple-design`, `/improve`. Pure questions, chat, notes, and config edits go direct.

Re-consult when the same error or verifier fails twice — stop before the third attempt and re-run the watchdog with the actual failing output. The user can also ask for a consultation at any point ("consult Sol" / "danış").

## The consult contract

Sol shares none of your conversation context. Every consult carries five parts:

1. **Objective** — the decision or task, one paragraph
2. **Files** — exact paths involved
3. **Evidence** — the actual diff, failing output, or commit; never a paraphrase
4. **Constraints** — project conventions, things not to touch
5. **Options considered** — what you're weighing, if anything

A consult you can't finish writing means the decision isn't formed yet — form it, or name the open question explicitly as part of the consult. A bare one-line task when concrete context exists wastes the call.

If Sol's guidance contradicts what you observe — a recommended step fails, file contents differ from its assumption — surface the conflict to the user instead of following it blindly.

## Final review — mandatory, native

Before reporting any source-code deliverable done, run the tiered native review. Sol is NOT part of it — Codex quota is reserved for planning.

1. `bash ~/.claude/hooks/review-tier.sh` prints the tier from the working-tree diff: `none` (no source changes — skip), `medium` (routine CRUD, UI, config-adjacent code), `high` (business logic, non-trivial refactors, risky vocabulary: auth/session/checkout/middleware), `xhigh` (unambiguous surfaces only: payment providers, crypto primitives, migrations/schema, or strong added-line signals like `STRIPE_SECRET_KEY`/`jwt.sign`). A `.review-tiers` file in the repo root (lines: `<xhigh|high> <regex>`) adds per-project floors.
2. Run the built-in `/review` skill at that tier. `high` runs with `--fix`, then re-run the verifier on the fixed diff. Escalate the tier with a stated reason if the diff warrants it; never downgrade.
3. Relay all findings; act on or surface each one.

Sol reads a diff only on demand ("danış" / "consult Sol") or when the user asks for a cross-vendor second opinion on an xhigh deliverable — that call spends Codex quota deliberately.

## Review output

When Sol does review a diff (on demand), it opens with a **SHIP / FIX-FIRST / RETHINK** verdict, then labels every finding `[ADOPT]` (real bug/security/perf), `[DISCUSS]` (debatable), `[STYLE]` (preference), `[OVER-ENGINEERED]` (complexity to cut).

Ask any reviewer — native or Sol — to report everything it finds — never "only high-severity issues" or "be conservative". A reviewer told to filter under-reports; prioritization happens with the user.

Relay all findings verbatim. Never silently drop one — the user decides what to apply.

## Gate

A PreToolUse hook blocks Edit/Write on real source files (`.ts .tsx .js .py .go .rs …`) until the advisor was called this task. Never gated: `~/.claude`, `~/.codex`, `/tmp`, `~/Desktop`, and any non-code file. The flag resets on each new task prompt and survives approval messages. Trivial source change → ask the user, don't fake the flag.

Advisor unreachable or watchdog cancels → continue alone. Only planning is lost.
