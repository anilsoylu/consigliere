# Advisor / Executor Loop

**Advisor (brain)** = the `advisor` subagent, running Fable with Read/Grep/Glob only. Plans and critiques, writes no code.
**Executor (hands)** = the main loop. Implements.

Claude Code's built-in advisor tool (`/advisor`, `advisorModel`) is not this advisor. It never clears the gate, and running both consults twice per decision.

## Call

```
Agent({ subagent_type: "advisor", name: "advisor", prompt: "<consult>" })
```

Spawn once per task, and name it so it stays addressable. Every later consult in the
same task goes to that live advisor with `SendMessage({ to: "advisor", … })`, which keeps
its context and its warm cache; a fresh `Agent` call rebuilds both from nothing and pays
the setup twice. Spawn again only when the task itself changes.

The final review is the exception — it always spawns fresh. An advisor that followed your
task has already seen your reasoning, and a judge that has read the justification anchors
to it.

This is the only way to invoke the advisor. The agent definition
(`~/.claude/agents/advisor.md`) carries the advisor doctrine — verdict-not-survey, no
manufactured objections, ~300-word cap — so never retype it into the prompt.

Every Agent call in this harness is asynchronous — there is no `run_in_background` parameter
to set. The consult returns as a task notification, so treat the notification as the barrier:
do work that does not depend on the verdict while you wait, and write no code until it lands.

Put the whole consult in the prompt, diffs included. There is no shell quoting to
corrupt it and no temp file to manage. For a large diff, name the files and paste the
hunks that matter — the advisor can Read the rest itself.

Read-only is structural, not a promise. The agent has Read, Grep and Glob and nothing
else — no Edit, no Write, no Bash, no network. It cannot change the repository even if it
decides it should. It can still ground itself by reading the files you name.

Anything a verdict needs that those three tools cannot reach — a web fact, a verifier
run, a live log, a remote call — comes back as `RESEARCH NEEDED: <question>` under a
verdict opening with PROVISIONAL. Do the work, then re-consult the same advisor with the
question, the answer and its source, and what you now intend to do; if the work cannot be
done, re-consult with that fact instead. A PROVISIONAL verdict is not a plan.

## When

Source-code changes and real design work, including `/code-review`, `/apple-design`,
`/improve`. Pure questions, chat, notes, and config edits go direct.

Consult once you have read the files and formed a candidate approach, before the first
source edit. The advisor never sees anything but the consult, so one written before you
have read the files is a verdict on your paraphrase. Consult sooner only for a non-obvious
design decision or a failure mode you cannot rule out by reading.

Re-consult when the same error or verifier fails twice — stop before the third attempt
and consult with the actual failing output. The user can also ask for a consultation at
any point ("consult the advisor" / "danış").

Grilling: when a fresh user prompt leaves two or more material decisions open (the
coding-discipline ask threshold, hit more than once in one task), run the grilling
skill before the first consult; the settled tree becomes the consult's objective and
options considered. A single open decision stays a one-line stated assumption. Grill
at most once per task, and never in unattended runs (ralph, cron, background
continuations): there, state the assumptions, proceed, and carry them into the consult.

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

## Final review — mandatory

Before reporting any source-code deliverable done, run the tiered review. The built-in
`/review` skill is not available for it: its frontmatter carries `disable-model-invocation`,
so the Skill tool refuses it and forbids replicating its workflow. Reserved for the user
typing `/review`, which is no use to a loop running while nobody is at the keyboard.

1. `node ~/.claude/hooks/review-tier.mjs` prints the tier from the working-tree diff. When the work is already committed on a branch the tree is clean, so pass the branch point instead — `node ~/.claude/hooks/review-tier.mjs . "$(git merge-base origin/main HEAD)"` — or the review silently classifies as `none`. Tiers: `none` (no source changes and no project floor matched — skip), `medium` (routine CRUD, UI, config-adjacent code), `high` (business logic, non-trivial refactors, risky vocabulary: auth/session/checkout/middleware), `xhigh` (unambiguous surfaces only: payment providers, crypto primitives, migrations/schema, or strong added-line signals like `STRIPE_SECRET_KEY`/`jwt.sign`). A `.review-tiers` file in the repo root (lines: `<xhigh|high> <regex>`) adds per-project floors, matched against every changed path — including ones no source extension covers, like a repo whose product is markdown.
2. Route the tier: `medium` and `high` go to a **fresh** advisor consult carrying the actual diff and asking for a review verdict; `xhigh` goes to the `merge-readiness` skill through the Workflow tool. Escalate the tier with a stated reason if the diff warrants it; never downgrade. merge-readiness costs up to 13 agents, so it never runs below `xhigh`.
3. Fix everything the reviewer stands behind — `[ADOPT]` from the advisor, anything that survived refutation from merge-readiness — then re-run the verifier on the fixed diff.
4. Relay all findings; act on or surface each one.

Write the review consult neutrally: state what the change does, never why you think it is
right. Statelessness keeps the reviewer from having *seen* your plan, but the five-part
contract will hand it your rationale if you let it, and a judge that reads the
justification anchors to it. You can still consult mid-task on demand ("danış").

## Review output

When the advisor reviews a diff it opens with a **SHIP / FIX-FIRST / RETHINK** verdict,
prefixed by `PROVISIONAL` when research is outstanding, then labels every finding
`[ADOPT]` (real bug/security/perf), `[DISCUSS]` (debatable), `[STYLE]` (preference),
`[OVER-ENGINEERED]` (complexity to cut).

Ask any reviewer — the advisor or merge-readiness — to report everything it finds —
never "only high-severity issues" or "be conservative". A reviewer told to filter
under-reports; prioritization happens with the user.

Relay all findings verbatim. Never silently drop one — the user decides what to apply.

## Gate

A PreToolUse hook blocks Edit/Write on real source files (`.ts .tsx .js .py .go .rs …`)
until the advisor was called since the last user prompt. Never gated: `~/.claude`, `/tmp`,
`~/Desktop`, and any non-code file. The flag resets on every user message except a short
approval — an informational reply mid-task resets it too — and survives the task
notifications and agent messages that background subagents deliver.

Hitting the gate is not a failure and not a question for the user — it is the consult
directive arriving late, because the prompt-time hook could only guess from wording where
a task would end while the gate holds the actual path. Consult, do unrelated work while the
verdict travels, then retry the same edit. Never fake the flag — and writing source through
Bash (`cat >`, `sed -i`) to sidestep the gate is the same thing, since the gate only matches
Edit/Write/MultiEdit. A second deny on the same
edit after a consult is the one exception: the hook is broken, not unsatisfied, so surface
it to the user instead of consulting again.

Advisor unreachable → continue alone. Only planning is lost.
