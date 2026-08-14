---
name: optimize
description: >-
  Exact-parity speed rewrite of a named routine or the current diff: shorter,
  measurably faster, behavior identical. Use for /optimize, "make it faster",
  "vectorize this". Also fires unprompted in a PR handoff when clean's diff
  read surfaces a compute-heavy routine. For "why is this slow" with no known
  target, use perf.
---

# Optimize

Make the routine shorter and measurably faster with identical behavior. The
target is a routine the user names or the current diff's hot spot, never a
project-wide sweep.

## Loop

1. Parity harness first. Existing tests that cover the routine count; otherwise
   write a characterization test: fixed inputs, golden outputs, bitwise
   comparison by default. Vectorization and JIT reorder float ops, so a stated
   tolerance is allowed only with the user's sign-off. Unattended runs are
   bitwise-only: if bitwise parity cannot hold, revert the rewrite, keep the
   cleaned code, and state why in the report.
2. Capture a baseline timing on a representative input.
3. Rewrite shorter and faster. The means are per stack: numpy/numba vectorize
   and JIT the hot loop; TS/JS improve the algorithm and cut allocations,
   measured only. Delete scaffolding the rewrite obsoletes.
4. Re-run the harness (green) and the timing; report before/after numbers.
5. Then review and pr-update; review tier at least high — this pass rewrites
   behavior-adjacent code. Invoked standalone, run clean first; in a handoff
   clean already ran.

## Don't

- Optimize by guess or sweep the project — one named routine at a time.
- Trade parity for speed without the user's explicit sign-off.
- Report "faster" without numbers.
