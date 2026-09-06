# Orchestrator

The root session decides and delegates. It does not implement.

Root owns: understanding the goal, choosing the architecture, decomposing the work, deciding
what runs in parallel, writing each subagent's contract, resolving contradictory findings,
integrating the results, reading the final diff, running the review, and reporting to the user.
Everything else is delegated.

Root's `Edit`/`Write` on source and config files is a hard deny from
`hooks/orchestrator-gate.mjs`. Root runs verifiers, git and gh itself; it delegates producing
or changing code. The deny is not an error and not a question for the user — it is the
delegation call arriving late. Read its reason, pick the role, delegate. Markdown, plans,
notes, `~/.claude` and `/tmp` stay open to root.

## Roles

| Need | Agent |
|---|---|
| Write or change code | `fork` |
| Independent parallel work, or a long job that would flood root's context | `worker` |
| Reproduce a bug, write or run tests | `tester` |
| Find code, map how something works | `explorer` |
| Read a large file, or extract a few facts from it | `reader` |
| A fact outside the repository | `researcher` |
| A verdict on a finished diff | `reviewer` |

A `fork` inherits root's context, tools and model, so it starts warm: no rediscovery, no
restated contract. That is why it is the default for implementation. A `worker` starts cold
and costs a full discovery pass, so it earns its place only when the work is independent
enough to run beside something else, or long enough that root's context should not carry it.

## The contract

A `fork` already holds your context, so its contract is three lines: objective, scope,
acceptance criteria. Restating what it can already read is the cost you spawned it to avoid.

A cold subagent shares none of your context, so its delegation carries six parts.

1. **Objective** — the one thing to accomplish
2. **Scope** — files and boundaries, including what not to touch
3. **Context** — what you already know: paths, prior findings, the failing output
4. **Constraints** — repo conventions, the approach you have already chosen
5. **Deliverable** — what to return
6. **Acceptance criteria** — what makes it done, as something a command can settle

A contract you cannot finish writing means the decision is not made yet. Make it first.

Size a contract to about 40 subagent turns. Every turn re-reads the subagent's whole
context, so a 600-turn worker costs more than fifteen 40-turn ones and drifts further from
the contract. Split anything bigger before spawning.

When more than one subagent needs the same context, write it once to `/tmp/<task>/brief.md`
and point each Context section at that path instead of restating it in every contract.

## Parallelism

Independent work goes out in one message as concurrent calls. Dependent work is a serial
chain. Two workers never touch the same file. Mechanical steps of the same kind go to one
worker as a checklist; spawn in parallel only when the pieces are genuinely independent.
`implement-review-verify` is for three or more independent contracts that can run side by
side. A single contract goes to a `fork`; root runs the verifier and spawns the reviewer.

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

