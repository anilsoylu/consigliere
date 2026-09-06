---
name: implement-review-verify
description: "Run one bounded contract end to end in a single call: a worker implements it, then a reviewer and a tester judge the result at the same time, then one fix round closes the ADOPT findings and a red verifier. Use for three or more independent contracts that run side by side; a single contract goes to a fork, with root running the verifier and spawning the reviewer."
---

# Implement, review, verify

One implement task normally costs the root four turns: spawn the worker, wait, read its
report, spawn the reviewer, wait, spawn the tester, wait, then decide. Each wait re-reads
the whole root context to advance one step, and the reviewer and the tester never overlap
even though neither needs the other's answer.

This runs the same sequence as a graph. The worker implements, the reviewer and the tester
judge in parallel, and a single fix round closes what they found. The root gets one result.

## Run it

Read `implement-review-verify.js` beside this file and pass its contents unchanged as
`script`. `scriptPath` is rejected here: the tool only accepts paths inside a working
directory, and the skill directory is never one.

```
Workflow({
  script: <contents of implement-review-verify.js>,
  args: {
    contract: "<the six-part contract, verbatim>",
    cwd: "/path/to/repo",
    verify: "npm test"
  }
})
```

- `contract` — the six-part contract you would have put in the worker's prompt: objective,
  scope, context, constraints, deliverable, acceptance criteria. It is passed to the worker
  unchanged, and again to the fix round.
- `cwd` — the repository to work in. Omitted, every agent uses the session's own working
  directory, which is wrong whenever the work lives somewhere else.
- `verify` — the command that decides whether the tree is sound. Omitted, the tester picks
  the narrowest one that can fail from `package.json` scripts, a Makefile, or a justfile.

## What it costs

Five agents at most, because the fix round runs once:

| Stage | Role | Count |
| --- | --- | --- |
| `implement` | `worker` | 1 |
| `review` | `reviewer` | 1 |
| `verify` | `tester` | 1 |
| `verify-retry` | `tester` | ≤1 |
| `fix` | `worker` | ≤1 |
| `verify-after-fix` | `tester` | ≤1 |

The retry and the fix round never both run. A verifier that comes back with no result at
all, on a change nothing was flagged ADOPT on, is re-run once; sending a worker at a defect
nobody has named would be guessing.

Every stage names an `agentType` rather than a model and an effort, so each one runs the
role as `~/.claude/agents` defines it. Change a role's `model:` or `effort:` line and this
skill follows without being edited.

The reviewer has no shell, so the worker writes the unified diff of the working tree to
`/tmp/implement-review-verify/diff.patch` and returns that path as `diffPath`. The reviewer
reads the patch, judges the hunks in it, and opens the changed files for the code around
them. It gets nothing else from the worker's report: what was written, never why, because a
judge that reads the justification anchors to it.

## What it returns

`verdict` (`SHIP`, `FIX-FIRST` or `RETHINK`), `provisional`, the full `findings` list with
its labels, `verifierExit` from the last run, `fixRound`, the worker's `workerReport`, and
`fixReport`, which is null unless a fix round ran.

It returns early instead of judging or verifying a tree that does not hold the change, and
says which case it hit: `escalated` (the worker handed the decision back, so nothing was
implemented), `no-result` (the worker returned nothing at all), or the same two on the fix
round, `fix-escalated` and `fix-no-result`, which keep the verdict and the findings already
in hand and skip the run that would have re-verified an unchanged tree.

The fix round is logged, and so is a verifier still red after it. The run stops there
rather than opening a second round: two failed attempts on the same error mean the
approach is wrong, which is the root's call and not this graph's.

## What it will not do

It does not open a PR, and it is not the handoff chain. `clean`, the review tier from
`review-tier.mjs`, and `pr-update` stay in the main loop where you can see them, and they
run over the whole branch rather than one contract.

It is one bounded task, not a plan. Decomposing the work, writing the contract, and
deciding what the findings mean are all still the root's.
