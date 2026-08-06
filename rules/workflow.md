# Workflow

## Planning
- Plan internally for anything with 3+ steps or an architectural decision. In `auto` mode don't stop for plan approval — plan, then execute.
- Stop and re-plan the moment something goes sideways instead of pushing the same approach.
- Ask for approval only before irreversible or outward-facing actions.
- A permission denial is information, not a wall. Read its stated reason before retrying. When it names a missing authorization, rewording the command cannot satisfy it — the same denial follows, and each attempt burns a turn. Ask once for the exact authorizing sentence, naming the tool, the target, and the irreversible effect ("say: run `asc metadata apply` against the live App Store listing"). A bare "yes, do it" will not clear an outward-facing gate, so don't treat one as if it did.
- Don't hand the user a command to paste as a substitute for that ask. It is the same interruption with the work moved onto them, and the result lands outside the session where nothing can verify it. Hand over only what genuinely needs their terminal: interactive logins, 2FA, physical keys.
- A general workflow problem is fixed in `~/.claude` rules, never by patching project files.
- Write only inside the current project. The boundary is the repo, not the working directory — in a monorepo, sibling `packages/*` and `apps/*` are in scope even from a nested cwd. A *different* repo is never in scope by implication: ask first, even for a one-line fix, even to undo your own change.

## Delegation
Match the primitive to the task. Small work needs no agents; deterministic steps belong in scripts. Reserve subagents for research and parallel exploration that would otherwise pollute main context — one focused task each. If one subagent can complete the task, use one rather than several, and keep spawn counts low. Never spawn a subagent to verify or double-check your own work — independent review comes from the advisor loop, not self-checks.

## Continuation loops
For work with a verifiable exit criterion, use exactly one runtime continuation mechanism: `/goal` or Ralph, never both. Before presenting or starting any `/ralph-loop`, read the `ralph-protocol` skill.

## Waiting
Never `sleep N` to poll a command. Blocking costs the wall-clock of the sleep, not of the job — and the estimate is always too long. Anything slower than ~30s goes `run_in_background: true`; keep working and the harness wakes you when it exits.
Never raise Bash's `timeout` parameter either. Reaching for a bigger ceiling means you expect a long run, and an expected-long run belongs in the background; if you don't expect one, the default 120000ms already covers it. Same for `TaskOutput` on a job you just backgrounded — the notification is coming, don't block on it.
Search with Grep/Glob, not shell `grep`/`find`/`ls`. The tools return instantly, a shell round-trip does not.

## Round-trips
Every tool call is a separate request that re-reads the entire context. Measured across 36,700 tool-carrying requests in one long-running setup: all but two carried exactly one call, so the context was paid for once per call. Batch independent calls into a single response — parallel Reads, Globs, Greps, unrelated Bash checks. Serialize only when a call's input depends on a prior result.
Never re-read a file already read this session; it is still in the context above. The harness suppresses the duplicate and returns "Wasted call" instead, so the repeat buys nothing and still costs a round-trip.

## Verification
Never mark a task complete without proving it works: run the tests, check the logs, diff the behavior. Report failures with their actual output; report skipped checks as skipped.
Run the narrowest test that can fail: the touched file's suite first, then its package. The full suite at most once per task, at the end, in the background; never re-run anything without an intervening change. A plan step is not self-justifying: if a prescribed check cannot change what you do next, skip it and say why.

## Elegance check
For non-trivial changes, pause once: is there a more elegant way? If a fix feels hacky, redo it properly now that you understand the problem. Skip this for obvious fixes.

## Self-improvement
After any correction from the user, save a `type: feedback` memory capturing the pattern, the why, and how to apply it. Recalled feedback memories are the single source of truth — no separate lessons file.

## Task tracking
For multi-step implementation work, keep `tasks/todo.md` with checkable items and mark them off as you go. The `ralph-protocol` skill has the full template.

## Git & PR
- One branch per task: `feat/ fix/ chore/ refactor/` + kebab-case summary. Never commit straight to `main`.
- Conventional commit subjects: `feat: … / fix: … / refactor: … / test: … / chore: … / docs: …`.
- Before `gh pr create`: tests green, lint clean, and `git diff origin/main` self-reviewed line by line.
- Open as `--draft` while work continues, `gh pr ready` when it is reviewable.
- Keep a PR under ~400 changed lines. Bigger work gets split into stacked PRs.
- Sync with `git rebase origin/main`; push rewritten history only with `--force-with-lease`, never bare `--force`.
- PR body answers three things: what changed, why, how it was verified. Link the issue.
- Delete the branch after merge; never reuse a merged branch.

## Core
No laziness. Find root causes, no temporary patches.
