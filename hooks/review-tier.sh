#!/usr/bin/env bash
# Prints the review effort tier for the current working-tree diff: none|medium|high|xhigh.
# Deterministic floors — the model may escalate the printed tier with a stated reason,
# never downgrade it. Optional per-repo overrides: a .review-tiers file in the repo root,
# one rule per line: "<xhigh|high> <extended-regex matched against changed paths>".
#
# Usage: review-tier.sh [repo-dir]
set -uo pipefail
cd "${1:-.}" 2>/dev/null || { echo none; exit 0; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo none; exit 0; }

EXT='\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|c|h|cpp|hpp|cc|vue|svelte|sql|sh)$'
FILES=$( { git diff --name-only HEAD -- 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | sort -u)
SRC=$(printf '%s\n' "$FILES" | grep -E "$EXT" || true)
[ -z "$SRC" ] && { echo none; exit 0; }

tier=medium
raise() {
  [ "$1" = xhigh ] && tier=xhigh
  [ "$1" = high ] && [ "$tier" = medium ] && tier=high
  return 0
}

# Per-repo overrides first (can only raise, never lower)
if [ -f .review-tiers ]; then
  while read -r t pat; do
    case "$t" in
      xhigh|high) [ -n "${pat:-}" ] && printf '%s\n' "$SRC" | grep -qiE "$pat" && raise "$t" ;;
    esac
  done < .review-tiers
fi

# Global floors: payment/auth/session/migration surfaces are always xhigh
printf '%s\n' "$SRC" | grep -qiE 'migrat|webhook|payment|stripe|billing|checkout|invoice|auth|clerk|session|crypt|secret|\.sql$' && raise xhigh

if [ "$tier" = medium ]; then
  n=$(printf '%s\n' "$SRC" | grep -c .)
  lines=$(git diff HEAD --numstat -- 2>/dev/null | awk -v ext="$EXT" '$3 ~ ext {s+=$1+$2} END{print s+0}')
  { [ "$n" -gt 3 ] || [ "${lines:-0}" -gt 150 ]; } && raise high
  printf '%s\n' "$SRC" | grep -qiE '/(server|api|services|lib|db|models)/' && raise high
fi

echo "$tier"
