---
name: review
description: >-
  The single review path for a finished diff — runs the tier check, spawns one
  reviewer, routes its findings. Use for "review this", "review the branch",
  "review before the PR", or as the review step of the handoff chain.
---

# Review

One pass. One reviewer. No step runs twice.

## Steps

1. **Tier.** `git merge-base origin/main HEAD`, then paste the sha (the gate denies `$(…)`):

       node ~/.claude/hooks/review-tier.mjs . <sha>

   `none` or `medium` → **stop, no review.** The verifier and root's own diff read cover
   those. Escalate the tier with a stated reason; never downgrade it.

2. **Scope.** Root runs `git diff <merge-base>...HEAD` and keeps the output. That diff is the
   review. Nothing else is in scope — not the working tree, not adjacent files, not the plan
   behind the change.

3. **Review.** Spawn `reviewer` fresh, once. **Paste the diff text into the prompt** —
   `reviewer` has `Read, Grep, Glob` and no Bash, so it cannot fetch the diff itself, and a
   reviewer handed only a command reconstructs the wrong change from the working tree. Name
   the repo root so it can open the files around the hunks. Give it the user's request in
   one sentence — verbatim when the request is one sentence, otherwise root's one-sentence
   restatement of what was asked and not why — and the tier, and no rationale: a judge that
   has read the justification anchors to it. The requirement is not the rationale; without
   it a correct diff that does the wrong thing ships.

4. **Lint the review.** `Write` the diff and the findings — `[{label, file, line, text}]` — to
   `/tmp/review/` (the gate denies root a `>`; `Write` is open), then:

       node ~/.claude/skills/review/review-lint.mjs /tmp/review/diff.patch /tmp/review/findings.json

   It reads the shape of the review and never the code: labels, caps, and whether every cited
   path is in the diff that was handed over. It reports and exits 0. A mismatch is yours to
   judge and never goes back to the reviewer.

5. **Route.** A `fork` fixes every `[ADOPT]`. Root re-runs the verifier, and a green run
   closes the finding — nothing re-reviews the fix. **Write** `[NOTE]` findings, including
   the reviewer's Inefficiency items, under `## Found while working`; a follow-up nobody
   wrote down is a finding nobody made.

6. **Stop.** Once the verifier is green, nothing short of a new `[ADOPT]` reopens the tree.

Record the model, the effort and the agent type beside the findings. Change the contract and an
unpinned count cannot tell you whether the diff moved or the judge did.

## Why one pass

A reviewer asked for findings returns findings, so a second review of the same tree produces
a second set. What closes a review is the green verifier, not the reviewer running out of
things to say.
