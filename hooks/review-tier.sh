#!/usr/bin/env bash
# Prints the review effort tier for the current working-tree diff: none|medium|high|xhigh.
# Deterministic floors — the model may escalate the printed tier with a stated reason,
# never downgrade it. Optional per-repo overrides: a .review-tiers file in the repo root,
# one rule per line: "<xhigh|high> <extended-regex matched against changed paths>".
#
# Precision policy: repeated false xhigh trains users to distrust the classifier, so the
# xhigh floors are deliberately narrow (unambiguous payment/crypto/migration surfaces plus
# a strict content scan of added lines), while the broad risky vocabulary (auth, login,
# session, checkout, ...) floors at high.
#
# Usage: review-tier.sh [repo-dir]
set -u
cd "${1:-.}" 2>/dev/null || { echo none; exit 0; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo none; exit 0; }

EXT='\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|php|java|kt|swift|c|h|cpp|hpp|cc|vue|svelte|sql|sh|prisma)$'
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

# xhigh path floors — narrow by design: migration/schema surfaces, payment providers,
# unambiguous crypto primitives ("crypt" alone would hit crypto-prices.ts)
XHIGH_PATH='(^|/)(migrations?|migrate)(/|$)|schema\.(prisma|sql)$|\.sql$|stripe|paypal|paddle|braintree|adyen|lemonsqueezy|iyzico|encrypt|decrypt|bcrypt|scrypt|argon2|hmac'
printf '%s\n' "$SRC" | grep -qiE "$XHIGH_PATH" && raise xhigh

# xhigh content floor — ADDED source lines (tracked diff + untracked source files),
# strong implementation signals only; bare SECRET/API_KEY/webhook/jwt are too noisy
if [ "$tier" != xhigh ]; then
  CONTENT='(STRIPE|PAYPAL|PADDLE|BRAINTREE|ADYEN|LEMONSQUEEZY|IYZICO)[A-Z0-9_]*(SECRET|PRIVATE|API)[_-]?KEY|service_role|payment_intent|PaymentIntent|jwt\.sign|createHmac|constructEvent|verifyWebhook'
  {
    git diff HEAD -- 2>/dev/null | awk -v ext="$EXT" '/^\+\+\+ /{insrc=(substr($0,7) ~ ext); next} insrc && /^\+/{print}'
    git ls-files --others --exclude-standard 2>/dev/null | grep -E "$EXT" | while IFS= read -r f; do cat "$f" 2>/dev/null; done
  } | grep -E "$CONTENT" >/dev/null && raise xhigh
fi

# high floors — broad risky vocabulary (author excluded), middleware, size, server dirs
if [ "$tier" = medium ]; then
  printf '%s\n' "$SRC" | grep -iE 'auth|login|logout|signin|signup|password|session|token|checkout|invoice|billing|payment|webhook|permission|rbac|acl|oauth|jwt|sso|otp|mfa|middleware' \
    | grep -viE 'author' | grep -q . && raise high
fi
if [ "$tier" = medium ]; then
  n=$(printf '%s\n' "$SRC" | grep -c .)
  lines=$(git diff HEAD --numstat -- 2>/dev/null | awk -v ext="$EXT" '$3 ~ ext {s+=$1+$2} END{print s+0}')
  { [ "$n" -gt 3 ] || [ "${lines:-0}" -gt 150 ]; } && raise high
  printf '%s\n' "$SRC" | grep -qiE '/(server|api|services|lib|db|models)/' && raise high
fi

echo "$tier"
