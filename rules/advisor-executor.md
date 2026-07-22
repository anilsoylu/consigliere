# Advisor / Executor Loop

Prompt → Plan (Codex Sol, read-only + watchdog) → user approval → Execute (Opus) → Verify.

The advisor is a subagent; it cannot talk to the user directly. The executor (main loop)
calls it, relays its plan, waits for approval, then implements.

- **Advisor (brain)** = Codex Sol 5.6 — read-only, watchdog-wrapped. Plans/critiques, writes NO code.
- **Executor (hands)** = Opus 4.8 @ high — the main loop. Implements after approval.

## Calling the advisor (read-only + watchdog, always)

```
bash ~/.claude/hooks/advisor-watchdog.sh "<task>. Do NOT web-search; mark external needs as 'RESEARCH NEEDED: <q>'."
```
- **Read-only is guaranteed, not promised.** The companion runs `task` WITHOUT `--write`, so its sandbox
  is `read-only` (verified in codex-companion.mjs: `sandbox: write ? "workspace-write" : "read-only"`).
  NEVER add `--write` to an advisor call — Sol physically cannot edit files. It may still use read-only
  tools (git diff/blame, ripgrep) to ground its review.
- **Watchdog:** background job + log-poll; auto-cancels if stalled >5 min (`WATCHDOG_HUNG`, exit 124) → continue on Opus alone. No 1-hour hangs.
- On success it prints Sol's output.

## Research round-trip (Sol has no web)

`web_search="disabled"` in `~/.codex/config.toml`. Sol marks `RESEARCH NEEDED: <q>` instead of searching;
Opus researches (WebSearch/WebFetch) and re-runs the watchdog with the findings so Sol finalizes.

## Review output: categorized verdict + zero-filter

When Sol REVIEWS (critique of a diff/code, not initial planning), tell it to label every finding:
- **[ADOPT]** — real bug / security / perf issue; should fix
- **[DISCUSS]** — debatable; worth a decision
- **[STYLE]** — preference; low priority
- **[OVER-ENGINEERED]** — unnecessary complexity to cut

**Zero-filter:** relay ALL of Sol's findings to the user verbatim; never silently drop any. The user
decides what to apply — human control over final implementation.

**Ground the call:** Sol only sees what you put in the prompt (plus its own read-only git/ripgrep).
On a review, name the exact diff/commit to inspect; on a recurring error, paste the failing output.
Don't send a bare one-line task when concrete context exists.

**Evidence over advice:** if Sol's guidance contradicts what you actually observe — a recommended
step fails when tried, or file contents differ from its assumption — surface the conflict to the user
instead of following it blindly. Still relay verbatim; just flag the contradiction.

## Flow

Source-code change or real design work — INCLUDING skills like `/code-review`, `/apple-design`, `/improve`:
1. **Plan** via the watchdog. 2. **Present**, wait for approval. 3. **Execute** as Opus high.
4. **Re-consult on a recurring error** — if the same error or verifier fails twice, STOP and re-run
   the watchdog with the actual error output before a third attempt. Don't loop the same fix blindly.
5. **Verify** (on critical changes, a categorized Sol review).
Pure questions / chat / notes / config edits → act directly, no advisor.

**On-demand:** the user can ask for a Sol consultation at any point ("consult Sol", "danış"), not
only at plan/review — run the watchdog then, mid-task.

## Enforcement gate (usable, narrow)

A PreToolUse gate blocks Edit/Write **only for real source-code files** (`.ts .tsx .js .py .go .rs ...`)
until the advisor was called this task. Exempt — never gated: `~/.claude`, `~/.codex`, `/tmp`,
`~/Desktop`, and any non-code file (`.md .txt .json .toml .yaml`). Flag resets each new-task prompt,
kept on approval. Trivial source change → ask the user; don't fake the flag (the classifier rejects it).

## Fallback

Advisor errors, is unreachable, or the watchdog cancels it → continue on Opus high alone. Only planning is lost.
