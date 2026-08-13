---
name: clean
description: >-
  Polish your own diff by hand with KISS/DRY and local style — the pre-handoff
  pass, not a test run and not a subagent sweep. Use for /clean, "clean it up",
  "tidy this", and as the first step of a PR handoff — before the review, not
  after it.
---

# Clean

KISS/DRY and copy the local code style. Be elitist, shorthand, clever, concise,
efficient, and elegant.

**"Clean" means polishing the code — it does NOT mean running the test suite,
tsc, or lint as the task.** Run a check only if it's genuinely needed to confirm
the polish is safe.

Clean is a standalone pass, not just a pre-PR step — run it whenever things get
messy, including mid-work. On a handoff it goes first, ahead of the review:
cleaning rewrites the diff, so a review that already ran judged code that no
longer exists.

## Do

1. Re-read your diff. Cut dead code, leftover debug logging, and duplication.
2. Extend existing helpers — don't parallel-implement.
3. Match neighboring style (names, imports, file layout, comment density).
4. Prefer the small sharp version over ceremony.
5. UI work: polish it only once the user is happy with the UI itself.
6. Stop at the code. The commit split, the title/body and the PR itself are
   `pr-update`'s job, and it runs after the review.

## Don't

- Run the test suite / tsc / lint just because you were told to "clean"
- Unrelated refactors
- New abstractions with one caller
- Scope creep dressed up as cleanup
