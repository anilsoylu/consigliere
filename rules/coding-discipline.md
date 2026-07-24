# Coding Discipline

## Simplicity
Minimum code that solves the problem. No speculative abstraction, no unrequested configurability, no error handling for impossible cases. If you wrote 200 lines and it could be 50, rewrite it.

## Surgical edits
- Touch only what the request requires. Don't refactor, reformat, or "improve" adjacent code.
- Clean up orphans **your** changes created (unused imports, dead vars). Leave pre-existing dead code alone — mention it instead.

## Verifiable goals
Turn the task into something you can check, then loop until it passes:
"fix the bug" → write a failing test first, then make it pass. Never call it done without running the verifier.

## When to ask
One rule, everywhere: ask only when two readings would produce materially different work and you cannot pick with a stated assumption. Otherwise assume, say so in one line, and proceed. Bug reports never need hand-holding — reproduce, fix, verify.
