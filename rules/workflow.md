# Workflow

## Planning
- Plan internally for anything with 3+ steps or an architectural decision. In `auto` mode don't stop for plan approval — plan, then execute.
- Stop and re-plan the moment something goes sideways instead of pushing the same approach.
- Ask for approval only before irreversible or outward-facing actions.

## Delegation
Match the primitive to the task. Small work needs no agents; deterministic steps belong in scripts. Reserve subagents for research and parallel exploration that would otherwise pollute main context — one focused task each.

## Continuation loops
For work with a verifiable exit criterion, use exactly one runtime continuation mechanism: `/goal` or Ralph, never both. Before presenting or starting any `/ralph-loop`, read the `ralph-protocol` skill.

## Verification
Never mark a task complete without proving it works: run the tests, check the logs, diff the behavior. Report failures with their actual output; report skipped checks as skipped.

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
