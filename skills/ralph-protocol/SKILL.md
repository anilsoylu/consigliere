---
name: ralph-protocol
description: Rules for a bounded /ralph-loop: start conditions, iteration discipline, verifier hierarchy, stop conditions. Read before starting one.
---

# Ralph Loop Protocol

Ralph is an **outer execution loop**, not a planning tool. It runs a plan that already exists.

## Entry conditions

Ralph may start only when both hold:

1. A written plan exists — an approved feature plan, **or** a minimal bug plan in `tasks/todo.md` containing goal, acceptance criteria, reproduction evidence, verification commands, and minimal steps.
2. There is an objective verifier (test, build, runtime check) and no unresolved product or architecture decision.

Never start Ralph during brainstorming, design review, read-only research, pure review, or while waiting on the user.

Never run `/goal` and Ralph in the same session — both hook Stop and produce conflicting continuation signals. `/goal` is for a session-scoped objective when no Ralph is active; it needs a deterministic success condition and an explicit turn cap.

## Iteration discipline

Each iteration:

1. Read the plan and `tasks/todo.md`.
2. Take the first incomplete, unblocked task.
3. TDD for behavior changes; smallest change that satisfies the task.
4. Run the focused verifier.
5. Record approach, evidence, learning, next action in `tasks/todo.md`.

Never repeat an unchanged failed approach. Re-plan when the same verifier fails twice or evidence invalidates an assumption. Max two re-plans per run.

## Verifier hierarchy

Strongest available wins:

1. End-to-end behavior / the project's `verify` skill
2. Focused and relevant full tests
3. Typecheck and build
4. Lint or static analysis
5. Diff and scope inspection
6. No deterministic verifier → explicit acceptance checklist plus independent review

Your own confidence, prose, or self-assigned score is not verification.

## Stop conditions

Every terminal response: exactly one result line, then `<promise>RALPH_LOOP_STOP</promise>`.

`RESULT: VERIFIED_COMPLETE` requires, in this session: fresh verification commands run and their full output plus exit status inspected; every acceptance criterion satisfied; runtime behavior exercised when there is a runtime surface; diff free of unrelated changes; no incomplete unblocked task left. Report skipped checks honestly — a required skipped check blocks a verified result.

`RESULT: BLOCKED` when a genuine user/product/architecture decision is needed, credentials or access are missing, the next action is destructive or externally visible without approval, criteria conflict or cannot be verified, or the iteration/re-plan cap is hit. Record the blocker evidence and required user action in `tasks/todo.md` first. Never claim success in a blocked result.

The promise is a transport-level stop signal, not proof of correctness. `/cancel-ralph` is the user's manual escape hatch, not something the running model can rely on.

## tasks/todo.md shape

```markdown
## Goal
## Acceptance Criteria
## Plan
## Verification Commands
## Attempts
- Approach
- Evidence/result
- Learning
- Next action
## Review
- Changes made
- Verification evidence
- Skipped checks
- Remaining blockers
```

The presence of `tasks/todo.md` never activates Ralph. Activation is explicit and session-scoped.

## Command template

Replace `<actual plan path>` with the real path before presenting. Never show the placeholder.

```text
/ralph-loop "
Read and execute the written implementation plan at <actual plan path>.
On every iteration, read tasks/todo.md, work on the first incomplete unblocked task, use TDD for behavior changes, run the actual plan verification commands, record failed approaches, and inspect the final diff.
For successful completion, output RESULT: VERIFIED_COMPLETE only after fresh verification. For a genuine blocker, record its evidence and required user action, then output RESULT: BLOCKED without claiming success. In either terminal case, finish with <promise>RALPH_LOOP_STOP</promise> so Ralph stops.
" --max-iterations 8 --completion-promise "RALPH_LOOP_STOP"
```

`--max-iterations 0` is prohibited. `--max-iterations 8` and `--completion-promise "RALPH_LOOP_STOP"` are required on every run.
