---
name: yagni
description: "A deletion pass over code you just wrote or are about to write: find generality nothing asked for, abstractions with one caller, configuration nobody sets, and facts maintained in two places, then remove them. Use when a change feels bigger than the problem, before opening a PR, or when reviewing a diff for size rather than correctness. Not a code review — it reports only what can be deleted."
---

# YAGNI

One job: make the code smaller without making it do less.

This is not a review. A review asks whether the code is right; this asks whether the
code needs to exist. The two produce different findings and mixing them ruins both — a
pass that also comments on naming, tests, and error handling is a second review with
softer criteria, and you learn to skip it.

## The test every finding must pass

> Does removing this produce fewer concepts, branches, configuration points, layers, or
> separately-maintained facts, without removing behavior something actually needs?

If the answer is no, the finding does not belong here — say nothing about it. A short
report is the normal outcome.

"Something actually needs" means a caller, a test, a ticket, or a stated requirement.
It does not mean a future that seems likely.

## What to look for

These are examples of the shape, not a checklist. The test above is the rule; the
patterns below are how it usually shows up.

**Generality with one instance.** An interface with one implementation, a strategy
table with one strategy, a base class with one subclass, a generic parameter always
passed the same type, a plugin system with one plugin. The abstraction is a guess about
a second case that has not arrived. Inline it and let the second case pay for itself.

**Wrappers that only forward.** A function, service, or module whose body is one call
to the thing behind it, with the arguments unchanged. It adds a name and a file and no
behavior.

**Configuration nobody sets.** A flag, option, env var, or parameter with a default and
zero non-default callers. Every one of them multiplies the states you have to reason
about and cannot afford to test. Delete the knob, keep the default.

**Error handling for impossible states.** A branch guarding a case the type system,
the caller, or the schema already rules out. It reads as caution and behaves as dead
code — and it hides the branches that can actually fire.

**Duplicated knowledge, not duplicated syntax.** The same *fact* — a limit, a route
shape, a status enum, a validation rule — independently maintained in two places will
drift, and the drift is a bug nobody attributes to duplication. Keep one authoritative
definition and derive the rest. Two blocks that merely look alike are not this: extract
them only when doing so removes code or removes a synchronization burden, not because
they rhyme.

**Layers passed straight through.** A value that enters at the edge and reaches its
use unchanged through three intermediaries that each name it, type it, and forward it.

**Speculative surface.** An exported symbol with no importer, a public method called
only by its own tests, an endpoint no client hits, a database column nothing reads.

**Premature performance.** A cache, memo, pool, or index added without a measurement
showing the thing it fixes. It buys speed with invalidation bugs.

## What this pass does not report

Naming. Formatting. General readability. Test coverage. The quality of error handling
that is genuinely needed. Whether the code is fast enough — an optimization already
justified by a measurement stays, and one that is missing is `/review`'s problem, not
this pass's. Architectural preference — which pattern is nicer, whether composition
beats inheritance, where state should live — unless the answer directly justifies
deleting code or dropping generality nothing uses.

All of that belongs to `/review`. Sending it here is how this pass stops being read.

## How to report

Per finding, three lines and nothing else:

1. The exact location — `path/to/file.ts:88-104`.
2. What is unnecessary **now**, in one sentence. Not "may be unnecessary".
3. The deletion, or the strictly smaller replacement, with a line count.

End with the total lines removable. If a finding has a real cost — a caller you would
have to touch, a public API that would change shape — name it in one clause. Do not
apply anything; the main loop makes the edits where they can be seen and stopped.

## When it is wrong to cut

Generality that is already paid for is not YAGNI. If a second implementation, a second
caller, or a second deployment target exists today, the abstraction is earning its
keep — leave it. Likewise a seam that a test genuinely needs in order to run.

The failure mode of this pass is deleting something load-bearing and calling it
simplification. When you cannot tell, say you cannot tell rather than guessing.
