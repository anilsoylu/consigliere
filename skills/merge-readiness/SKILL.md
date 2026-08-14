---
name: merge-readiness
description: "Review a large or risky diff with a graph of subagents instead of one pass: four parallel lenses find defects, then a stronger review configuration than the one that found each defect tries to refute it. Use before merging a branch you would not merge on a single reviewer's word. Costs up to 13 agents, so it is opt-in, not automatic."
---

# Merge readiness

A single review pass has one perspective and one judge, and that judge is whatever
wrote the finding. This runs the review as a graph instead: four lenses read the diff
in parallel, then every finding is handed to a judge that did not write it, running at
a stronger configuration than the reviewer that did, and told to refute it.

This sits **above** `hooks/review-tier.sh`, not instead of it. Routine diffs stay on the
single advisor consult that `medium` and `high` route to. Reach for this when the tier
comes back `xhigh`, or when a `high` diff is large enough that one reviewer will miss
something and you can say why.

## Run it

Call the **Workflow** tool with the script bundled next to this file:

```
Workflow({
  scriptPath: "<this skill's directory>/merge-readiness.js",
  args: { cwd: "/path/to/repo", verify: "npm test", base: "origin/main" }
})
```

Installed with `node install.mjs --with-merge-readiness`, that path is
`~/.claude/skills/merge-readiness/merge-readiness.js`.

All three args are optional:

- `cwd` — the repository to review. Omitted, every agent uses the session's own working
  directory, which is wrong whenever the branch lives somewhere else — and a session
  whose cwd is not a git repo aborts the run at the baseline node.
- `verify` — the command that decides whether the tree is sound. Omitted, the first
  agent finds it from `package.json` scripts, a Makefile, or a justfile.
- `base` — what to diff against. Defaults to `origin/HEAD`; when that does not resolve the
  first agent falls back through `origin/main`, `origin/master`, `main`, `master`, and the
  tracked branch's merge-base. `origin/HEAD` is unset more often than you would think —
  `git init` plus a remote, or a CI checkout — and a diff command that errors would
  otherwise hand four lenses nothing and yield a confident "found no defects".

## What it costs

Thirteen agents at most, and the assignment is deliberate:

| Stage | Model | Effort | Count | Role |
| --- | --- | --- | --- | --- |
| `baseline-gates` | sonnet | low | 1 | Resolves the diff base, runs the verifier, reports the exit code |
| `audit` | opus | high | 4 | security, data-migration, api-contract, perf — parallel |
| `verify-tier-1` | opus | xhigh | ≤5 | Tries to refute each finding |
| `verify-tier-2` | fable | high | ≤2 | Settles the disputed ones |
| `triage` | sonnet | medium | 1 | Dedupe and rank |

Two rules hold the design up:

**The judge is never weaker than the author.** Tier 1 rises on the *effort* axis — same
model as the audit that produced the finding, more thinking. Tier 2 rises on the *model*
axis and steps effort back down, so you never pay for both at once.

**The judge does not see the author's reasoning.** Tier 1 gets the claim and the hunk,
nothing else. A judge that reads the justification anchors to it and approves.

## What it will not do

It writes no code. Every judging node is schema-bound to return a verdict object, so it
cannot drift into producing a patch. Fable in particular is verdict-only by construction
— it is the ceiling of the ladder, and nothing above it could review code it wrote.

Fixes happen afterwards, in the main loop, with the ranked findings as input. The repair
loop stays where you can see it and stop it.

## What it returns

A ranked list of findings that survived refutation, plus counts of what was audited,
verified, and escalated.

It aborts after the first agent rather than reviewing something it cannot review, and says
which case it hit: `baseline-failed` (the verifier is already red, so reviewing this tree
wastes the run), `unresolved-base` (no diff base resolved — pass `base` yourself), or
`empty-diff` (the range holds no files).

Caps are logged, never silent. If more findings were found than verified, or more
warranted escalation than were escalated, the run says so.
