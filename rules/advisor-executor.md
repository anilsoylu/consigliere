# Advisor / Executor Loop

**Advisor (brain)** = the `advisor` subagent, running Fable with Read/Grep/Glob only. Plans and critiques, writes no code.
**Executor (hands)** = the main loop. Implements.

## Call

```
Agent({ subagent_type: "advisor", prompt: "<consult>", run_in_background: false })
```

This is the only way to invoke the advisor. The agent definition
(`~/.claude/agents/advisor.md`) carries the advisor doctrine — verdict-not-survey, no
manufactured objections, ~300-word cap — so never retype it into the prompt.

Run it synchronously (`run_in_background: false`). You need the verdict before you write
code; a background consult defeats the point.

Put the whole consult in the prompt, diffs included. There is no shell quoting to
corrupt it and no temp file to manage. For a large diff, name the files and paste the
hunks that matter — the advisor can Read the rest itself.

Read-only is structural, not a promise. The agent has Read, Grep and Glob and nothing
else — no Edit, no Write, no Bash. It cannot change the repository even if it decides it
should. It can still ground itself by reading the files you name.

The advisor has no web access; it emits `RESEARCH NEEDED: <q>` instead. Research those
yourself, then re-consult with the findings appended.

## When

Source-code changes and real design work, including `/code-review`, `/apple-design`,
`/improve`. Pure questions, chat, notes, and config edits go direct.

Re-consult when the same error or verifier fails twice — stop before the third attempt
and consult with the actual failing output. The user can also ask for a consultation at
any point ("consult the advisor" / "danış").

## The consult contract

The advisor shares none of your conversation context. Every consult carries five parts:

1. **Objective** — the decision or task, one paragraph
2. **Files** — exact paths involved
3. **Evidence** — the actual diff, failing output, or commit; never a paraphrase
4. **Constraints** — project conventions, things not to touch
5. **Options considered** — what you're weighing, if anything

A consult you can't finish writing means the decision isn't formed yet — form it, or
name the open question explicitly as part of the consult. A bare one-line task when
concrete context exists wastes the call.

If the advisor's guidance contradicts what you observe — a recommended step fails, file
contents differ from its assumption — surface the conflict to the user instead of
following it blindly.

## Final review — mandatory, native

Before reporting any source-code deliverable done, run the tiered native review. The
advisor is NOT part of it — it plans, it does not gate.

1. `bash ~/.claude/hooks/review-tier.sh` prints the tier from the working-tree diff: `none` (no source changes — skip), `medium` (routine CRUD, UI, config-adjacent code), `high` (business logic, non-trivial refactors, risky vocabulary: auth/session/checkout/middleware), `xhigh` (unambiguous surfaces only: payment providers, crypto primitives, migrations/schema, or strong added-line signals like `STRIPE_SECRET_KEY`/`jwt.sign`). A `.review-tiers` file in the repo root (lines: `<xhigh|high> <regex>`) adds per-project floors.
2. Run the built-in `/review` skill at that tier. `high` runs with `--fix`, then re-run the verifier on the fixed diff. Escalate the tier with a stated reason if the diff warrants it; never downgrade.
3. Relay all findings; act on or surface each one.

The advisor reads a diff only on demand ("danış" / "consult the advisor"), or when you
want a second opinion on an xhigh deliverable from a model that did not write it.

## Review output

When the advisor does review a diff (on demand), it opens with a **SHIP / FIX-FIRST /
RETHINK** verdict, then labels every finding `[ADOPT]` (real bug/security/perf),
`[DISCUSS]` (debatable), `[STYLE]` (preference), `[OVER-ENGINEERED]` (complexity to cut).

Ask any reviewer — native `/review` or the advisor — to report everything it finds —
never "only high-severity issues" or "be conservative". A reviewer told to filter
under-reports; prioritization happens with the user.

Relay all findings verbatim. Never silently drop one — the user decides what to apply.

## Gate

A PreToolUse hook blocks Edit/Write on real source files (`.ts .tsx .js .py .go .rs …`)
until the advisor was called this task. Never gated: `~/.claude`, `~/.codex`, `/tmp`,
`~/Desktop`, and any non-code file. The flag resets on each new task prompt and survives
approval messages. Trivial source change → ask the user, don't fake the flag.

Advisor unreachable → continue alone. Only planning is lost.
