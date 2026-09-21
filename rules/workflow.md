# Workflow

## Planning
- Plan internally for anything with 3+ steps or an architectural decision. In `auto` mode don't stop for plan approval — plan, then execute.
- Stop and re-plan the moment something goes sideways instead of pushing the same approach.
- Ask for approval only before irreversible or outward-facing actions.
- A permission denial is information, not a wall. Read its stated reason before retrying. When it names a missing authorization, rewording the command cannot satisfy it — the same denial follows, and each attempt burns a turn. Ask once for the exact authorizing sentence, naming the tool, the target, and the irreversible effect ("say: run `asc metadata apply` against the live App Store listing"). A bare "yes, do it" will not clear an outward-facing gate, so don't treat one as if it did.
- Don't hand the user a command to paste as a substitute for that ask. It is the same interruption with the work moved onto them, and the result lands outside the session where nothing can verify it. Hand over only what genuinely needs their terminal: interactive logins, 2FA, physical keys.
- A general workflow problem is fixed in `~/.claude` rules, never by patching project files.
- Writes under `~/.claude` are routed to auto mode's classifier. Markdown usually passes; hook and config code is denied as `[Self-Modification]`. Nothing pre-authorizes it: `permissions.allow` is evaluated after the protected-path check, so `Edit(.claude/**)` has no effect, rewording the edit draws the same denial, and handing it to a subagent is circumvention rather than a route. It clears one way — name what was flagged and why, then ask whether the flag is wrong. A bare "yes, do it" does not clear it, because consent to proceed is not the user seeing the pattern and rejecting it. `~/.claude/projects/*/memory/` is exempt and needs no question.
- That ask is the only exception to the no-questions and no-handover rules above. Git plumbing on the user's own repos — push, merge, tag, PR — is pre-authorized and must never produce a question or a handed-over command. `[Self-Modification]` earns a question because the named question is its only clearing mechanism.
- Write only inside the current project. The boundary is the repo, not the working directory — in a monorepo, sibling `packages/*` and `apps/*` are in scope even from a nested cwd. A *different* repo is never in scope by implication: ask first, even for a one-line fix, even to undo your own change.

## Delegation
Match the primitive to the task. Deterministic steps belong in scripts. Implementation goes to a `fork`: it starts with root's context, so there is no discovery pass and no restated contract. A cold `worker` is for independent parallel work, or a job whose output should stay out of root's context. Root runs the verifier itself instead of spawning a tester for it. Give a cold subagent one focused task each time. If one subagent can complete the task, use one rather than several, and keep spawn counts low. Never spawn a subagent to verify or double-check your own work — independent review comes from the one handoff review.
Load a skill when the task is the one it covers, not because a keyword in the prompt matches its name.

## Continuation loops
For work with a verifiable exit criterion, use exactly one runtime continuation mechanism: `/goal` or Ralph, never both. Before presenting or starting any `/ralph-loop`, read the `ralph-protocol` skill.

## Waiting
Never `sleep N` to poll a command. Blocking costs the wall-clock of the sleep, not of the job — and the estimate is always too long. Anything slower than ~30s goes `run_in_background: true`; keep working and the harness wakes you when it exits.
Never raise Bash's `timeout` parameter either. Reaching for a bigger ceiling means you expect a long run, and an expected-long run belongs in the background; if you don't expect one, the default 120000ms already covers it. Same for reading a backgrounded job's output file before its notification arrives — the notification is coming, don't poll for it.
Search with Grep/Glob, not shell `grep`/`find`/`ls`. The tools return instantly, a shell round-trip does not.

## Round-trips
Every tool call is a separate request that re-reads the entire context, so a turn carrying a single call pays for the whole context to advance one step. Batch independent calls into a single response — parallel Reads, Globs, Greps, unrelated Bash checks. Serialize only when a call's input depends on a prior result.
Never re-read a file already read this session; it is still in the context above. The harness suppresses the duplicate and returns "Wasted call" instead, so the repeat buys nothing and still costs a round-trip.

## Verification
Never mark a task complete without proving it works: run the tests, check the logs, diff the behavior. Report failures with their actual output; report skipped checks as skipped.
Run the narrowest test that can fail: the touched file's suite first, then its package. The full suite runs once per verification batch, at the end, in the background; never re-run anything without an intervening change. A batch is the work verified together — with a `tasks/todo.md` queue that is normally the whole queue, not one item. The suite is the expensive step, and a queue exists so it can be paid once. Per item run only the cheap verifiers — typecheck, lint, the touched file's suite — which catch a break while the change is fresh. A plan step is not self-justifying: if a prescribed check cannot change what you do next, skip it and say why.
Triage a red batch-end suite before fixing it. A failure this batch caused is the batch's to fix; one that was already red at the merge-base is not. Check rather than assume — the base commit or a stashed tree settles it in one run.

Never pipe a verifier through `tail`, `head`, or `grep`. The pipeline's exit status becomes the filter's, so a red run reads as green and `$?` lies; the lines a filter drops are usually the failure itself. Redirect instead — `<verifier> > /tmp/<name>.log 2>&1; echo "exit=$?"` — then grep the file.
One verifier per Bash call. Never chain `A && B`: with a filter anywhere in A the guard does not hold, B runs against a tree A already condemned, and the two outputs interleave into a log where neither result is legible. Run A, read its exit code, then run B.
A backgrounded verifier is not finished until you have read its exit code. If a turn ends without one, re-read the output file before anything else — never infer a pass from a notification that did not arrive.
A verifier owns the files it covers while it runs. Do not edit them until it has reported, or its result belongs to neither version. The batch-end suite covers the tree, so while it runs the work is everything that is not an edit — reading the diff, drafting the PR body, planning the next batch.

## Elegance check
If a fix feels hacky, redo it properly now that you understand the problem. Skip this for obvious fixes.

## Self-improvement
After any correction from the user, save a `type: feedback` memory capturing the pattern, the why, and how to apply it. Recalled feedback memories are the single source of truth — no separate lessons file.

## Task tracking
For multi-step implementation work, keep `tasks/todo.md` with checkable items and mark them off as you go. The `ralph-protocol` skill has the full template.
Update it in batches, not per checkbox. A tick is a full tool round-trip that re-reads the context to change one character, so a plan file rewritten after every item costs more than the tracking is worth. Write it once when a group of items lands, when the plan itself changes, or before you stop.
Plan a queue as a batch: implement the items, then verify once. Stopping to verify after each box pays the suite N times for one tree.
The queue is frozen when the batch starts. Work found while it runs goes under a `## Found while working` heading in the same file, not into the queue. Only a regression this batch caused belongs to this batch: it is the one permitted append, goes back onto the task list, and the batch is not done until it is green. Report the rest at handoff and let the user pick what becomes the next batch.

## Git & PR
- Handoff is one pass per PR: verifier green → `review` → `cpr`, which runs `clean` then
  `pr-update` with no gap. No step runs twice.
- Review is the `review` skill, and it is the only review path. It runs the tier check
  itself — `node ~/.claude/hooks/review-tier.mjs . <merge-base>`, printing
  `none | medium | high | xhigh` — stops on `none`/`medium`, and otherwise spawns `reviewer`
  fresh, once, with the diff and the tier and no rationale. Always pass the merge-base; the
  bare form reads the working tree only. Escalate the tier with a stated reason, never
  downgrade it. A repo can raise the floor for its own paths with a `.review-tiers` file at
  the root, one `<xhigh|high> <regex>` rule per line.
- Findings come back under two labels: `[ADOPT]` blocks the merge, `[NOTE]` does not. A fork
  fixes every `[ADOPT]`, root re-runs the verifier, and a green run closes the finding.
  Nothing re-reviews the fix. A branch whose whole diff came out of one
  `implement-review-verify` run is already reviewed. `/merge-readiness` runs only when the
  user asks for it. Once the verifier is green, no finding short of an `[ADOPT]` reopens the
  tree. `[NOTE]` findings go under the `## Found while working` heading and ship as
  follow-ups.
- `clean` is one read of the diff before the PR exists, not a round. Use `clean` or
  `pr-update` on their own only when the diff is not being shipped yet. If that read shows a
  compute-heavy routine (data loops, math kernels, parsers, media processing) was added or
  materially changed, run `optimize` before it; otherwise skip silently.
- `pr-ready` is not part of that chain. It unblocks an already-open PR (stale base, red
  CI, open threads).
- One branch per verification batch: `feat/ fix/ chore/ refactor/` + kebab-case summary. Never commit straight to `main`.
- Conventional commit subjects: `feat: … / fix: … / refactor: … / test: … / chore: … / docs: …`.
- Before `gh pr create`: tests green, lint clean, and `git diff origin/main` self-reviewed line by line.
- A draft PR on a repo you own is routine, not outward-facing: open it without asking. A
  PR against someone else's repo needs approval first.
- Open as `--draft` while work continues, `gh pr ready` when it is reviewable.
- Keep a PR under ~400 changed lines. Bigger work gets split into stacked PRs.
- Sync with `git rebase origin/main`; push rewritten history only with `--force-with-lease`, never bare `--force`.
- PR body answers three things: what changed, why, how it was verified. Link the issue.
- Delete the branch after merge; never reuse a merged branch.
- After the merge, `/clear`. Every turn re-reads the whole context, and a fork inherits all
  of it; a session that carries one finished task into the next pays for both on every
  call.

## Core
Find root causes, no temporary patches.
