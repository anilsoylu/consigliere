# Workflow Orchestration

## 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

## 2. Subagent Strategy

- Match the primitive to the task: small tasks need no agents; use scripts for deterministic steps
- Reserve subagents for research, exploration, and parallel analysis that would pollute main context
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

## 2b. Hand Off the Stop Condition

- For tasks with verifiable exit criteria, use exactly one runtime continuation mechanism:
  - Use `/goal` for a session-scoped objective when no Ralph loop is active.
  - Use `/ralph-loop` only for bounded execution of a written plan: an approved feature plan or a minimal reproducible-bug plan that meets section 2c.
- Never run `/goal` and Ralph in the same session. Both operate at the Stop-hook layer and can produce conflicting continuation signals.
- Every `/goal` must include a deterministic success condition and an explicit turn cap.
- Every Ralph run must set `--max-iterations 8` and `--completion-promise "RALPH_LOOP_STOP"`.
- `--max-iterations 0` is prohibited.

## 2c. Loop Engineering Protocol

### Phase boundaries

1. **Discover**: inspect the project, reproduce the problem, and identify the real work.
2. **Plan**: design the approach and write the plan. Feature work completes all required user approval gates. A reproducible bug with an objective verifier may skip separate design approval only after `tasks/todo.md` records the goal, acceptance criteria, reproduction evidence, verification commands, and minimal implementation steps.
3. **Execute**: after the required approval or minimal written bug plan exists, work on the first incomplete, unblocked item in `tasks/todo.md`.
4. **Verify**: run the strongest available objective verifier and inspect its fresh output.
5. **Iterate**: record the result, change the approach when evidence rejects it, and repeat until a stop condition is reached.

Ralph is an outer execution loop, not a planning tool:

- Never start Ralph during brainstorming, design review, plan review, or while waiting for user input.
- For approved multi-step feature work, provide the user with a bounded `/ralph-loop` command using the approved plan path and its actual verification commands.
- For a clear bug with an objective reproducer and no unresolved product or architecture decision, first write the minimal bug plan in `tasks/todo.md`, then Ralph may begin with systematic debugging without a separate user approval gate.
- Do not use Ralph for simple questions, read-only research, brainstorming, pure review, or tasks without an objective verifier.

### Iteration rules

Each execution iteration must:

1. Read the written plan and `tasks/todo.md`.
2. Select the first incomplete, unblocked task.
3. Use test-driven development for behavior changes.
4. Make the smallest change required for the selected task.
5. Run the focused verifier.
6. Record the approach, evidence, learning, and next action in `tasks/todo.md`.
7. Never repeat an unchanged failed approach.
8. Re-plan when the same verifier failure occurs twice or evidence invalidates an assumption.

Allow at most two re-plans within one Ralph run.

### Verifier hierarchy

Use the strongest available verifier in this order:

1. End-to-end behavior or the project's `verify` skill.
2. Focused and relevant full tests.
3. Typecheck and build.
4. Lint or static analysis.
5. Diff and scope inspection.
6. When no deterministic verifier exists, an explicit acceptance checklist plus independent review.

Claude's own confidence, prose explanation, or self-assigned score is not verification.

### Completion and stop conditions

Ralph uses a neutral transport promise. Every terminal response must contain exactly one result line followed by `<promise>RALPH_LOOP_STOP</promise>`.

Before `RESULT: VERIFIED_COMPLETE`:

- Run fresh verification commands and inspect their complete output and exit status.
- Confirm every acceptance criterion is satisfied.
- Exercise runtime behavior when the change has a runtime surface.
- Confirm the diff contains no unrelated changes.
- Confirm `tasks/todo.md` has no incomplete, unblocked implementation task.
- Report skipped checks honestly; a required skipped check blocks a verified result.

Use `RESULT: BLOCKED` instead when:

- A genuine user, product, or architectural decision is required.
- Credentials or external access are missing.
- The next action is destructive or externally visible and lacks approval.
- Acceptance criteria conflict or cannot be verified.
- The maximum iteration or re-plan limit is reached.

Before `RESULT: BLOCKED`, record the blocker evidence and required user action in `tasks/todo.md`. Never claim success in a blocked result. Then emit the neutral stop promise so Ralph exits immediately.

`/cancel-ralph` is a manual user escape hatch, not an action the running model can rely on.

## 3. Self-Improvement Loop

- After ANY correction from the user: save a `type: feedback` memory (see the Memory section of the global instructions) capturing the pattern, the why, and how to apply it
- Write the memory as a rule for yourself that prevents the same mistake
- Recalled feedback memories are the single source of truth — no separate `tasks/lessons.md`

## 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness
- A Ralph completion promise is a neutral transport-level stop signal, not proof of correctness.
- Emit `RESULT: VERIFIED_COMPLETE` only when fresh verification evidence exists in the current session.
- If verification fails, keep the task open and iterate; if progress genuinely requires the user, record the evidence and emit `RESULT: BLOCKED` without claiming success.

## 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

## 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how
- A bug-fix Ralph loop may skip a separate design and user approval gate only when the failure is reproducible, the verifier is objective, no product or architectural decision is unresolved, and a minimal written plan exists in `tasks/todo.md`.
- Otherwise complete the normal design and plan approval flow before starting Ralph.

---

# Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Save a `type: feedback` memory after corrections

For non-trivial implementation work, `tasks/todo.md` must include:

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

The presence of `tasks/todo.md` never activates Ralph. Ralph activation is explicit and session-scoped through `/ralph-loop`.

After a feature plan is approved, or after a qualifying bug has the required minimal written plan, provide a project-specific command in this form:

```text
/ralph-loop "
Read and execute the written implementation plan at <actual plan path>.
On every iteration, read tasks/todo.md, work on the first incomplete unblocked task, use TDD for behavior changes, run the actual plan verification commands, record failed approaches, and inspect the final diff.
For successful completion, output RESULT: VERIFIED_COMPLETE only after fresh verification. For a genuine blocker, record its evidence and required user action, then output RESULT: BLOCKED without claiming success. In either terminal case, finish with <promise>RALPH_LOOP_STOP</promise> so Ralph stops.
" --max-iterations 8 --completion-promise "RALPH_LOOP_STOP"
```

Replace `<actual plan path>` with the real path before presenting the command. Never present the template with that placeholder intact.

---

# Core Principles

- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.

(Simplicity and surgical/minimal-impact editing live in `coding-discipline.md` — not repeated here.)
