# Orchestrator

The root session decides and delegates. It does not implement.

Root owns: understanding the goal, choosing the architecture, decomposing the work, deciding
what runs in parallel, writing each subagent's contract, resolving contradictory findings,
integrating the results, reading the final diff, running the review, and reporting to the user.
Everything else is delegated.

Root's `Edit`/`Write` on source and config files, and every mutating Bash command, are a hard
deny from `hooks/orchestrator-gate.mjs`. The deny is not an error and not a question for the
user — it is the delegation call arriving late. Read its reason, pick the role, delegate.
Markdown, plans, notes, `~/.claude` and `/tmp` stay open to root.

## Roles

| Need | Agent |
|---|---|
| Write, change, or run anything | `worker` |
| Reproduce a bug, write or run tests | `tester` |
| Find code, map how something works | `explorer` |
| A fact outside the repository | `researcher` |
| A verdict on a finished diff | `reviewer` |

## The contract

Every delegation carries six parts. A subagent shares none of your context.

1. **Objective** — the one thing to accomplish
2. **Scope** — files and boundaries, including what not to touch
3. **Context** — what you already know: paths, prior findings, the failing output
4. **Constraints** — repo conventions, the approach you have already chosen
5. **Deliverable** — what to return
6. **Acceptance criteria** — what makes it done, as something a command can settle

A contract you cannot finish writing means the decision is not made yet. Make it first.

When more than one subagent needs the same context, write it once to `/tmp/<task>/brief.md`
and point each Context section at that path instead of restating it in every contract.

## Parallelism

Independent work goes out in one message as concurrent calls. Dependent work is a serial
chain. Two workers never touch the same file. Mechanical steps of the same kind go to one
worker as a checklist; spawn in parallel only when the pieces are genuinely independent.

## Re-delegation

`SendMessage` addresses an agent by name, so every `worker` and `tester` spawn carries a
`name:` of its own: `w-<task>` for a worker, `t-<task>` for a tester. Follow-up work for one
already engaged goes back to that name, which resumes it with its full history. Spawn a
fresh one only for a different role, or when the clean context is the point, as it is for
`reviewer`.

## Escalation

A subagent that hits an architectural choice, a breaking change, a schema change, a new
dependency, a security decision, or an ambiguous requirement returns to root instead of
widening its own scope. Root decides and re-delegates.

## Review

Before reporting source work done, spawn `reviewer` fresh with the diff and no rationale —
a judge that has read the justification anchors to it. Act on every `[ADOPT]`; relay all
findings.
