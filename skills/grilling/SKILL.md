---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

<!-- Vendored from https://github.com/mattpocock/skills (MIT), edited to fit this setup:
     plain-markdown question format, advisor handoff line. -->

# Grilling

Interview the user relentlessly until you reach a shared understanding. Map this
as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose
prerequisites are already settled: the questions you can ask *now* without
guessing at answers you have not heard yet. Ask the whole frontier in one round,
number each question, and give your recommended answer. Then wait for the user's
answers before the next round.

Format each question like this:

```
**Q1. <question title>**
<question body; may be several paragraphs, may list choices>

Recommended: <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the
frontier outward and unblock the questions that depended on them. Recompute the
frontier and ask the next round. A question whose answer depends on another
question still open in this round belongs to a later round, not this one.

Finding *facts* is your job, never the user's. When a frontier question needs a
fact from the environment (filesystem, tools, etc.), dispatch a subagent to find
it. Do not ask the user for anything you could look up yourself, and do not
block on it: a running exploration is an unsettled prerequisite, so only the
questions downstream of it wait for the subagent to report. Ask the rest of the
frontier now. The *decisions* are the user's: put each one to them and wait.

The session is done when the frontier is empty: every branch of the design tree
visited, nothing left silently assumed. Do not act on it until the user confirms
you have reached a shared understanding.

On source-code tasks, the settled tree becomes the advisor consult's objective
and options-considered: grill first, then consult, then edit.
