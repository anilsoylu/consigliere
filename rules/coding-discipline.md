# Coding Discipline

## Simplicity
Minimum code that solves the problem. No speculative abstraction, no unrequested configurability, no error handling for impossible cases. If you wrote 200 lines and it could be 50, rewrite it.

## Comments
Only add comments as a last resort for weird cases. Prefer short comments.
Default to none. A comment earns its line by saying **why** — the constraint, the rejected alternative, the bug it prevents. Never what the code already says. One line; two only when the reason genuinely needs it. If the explanation is longer than the code it sits on, it belongs in the commit message or the README, not the file.
Same rule for prose you write into the repo: a docstring restating the signature, a test name explaining itself, a plan file narrating what a diff already shows. Every one of them is read into context on every future session.

## Repo prose
README, design docs, PR bodies, commit messages: plain declarative sentences. Nothing written for rhythm — no pull-quote opener, no "not X, but Y", no list padded to three items, no one-line paragraph that only sets up the next one.

## Surgical edits
- Touch only what the request requires. Don't refactor, reformat, or "improve" adjacent code.
- Clean up orphans **your** changes created (unused imports, dead vars). Leave pre-existing dead code alone — mention it instead.

## Verifiable goals
Turn the task into something you can check, then loop until it passes:
"fix the bug" → write a failing test first, then make it pass. Never call it done without running the verifier.

## UI copy
Do not add subtitles, helper text, or descriptive copy beneath headings, labels, cards,
or settings by default. Prefer one concise, self-explanatory heading or label. Add
supporting copy only when the user explicitly asks for it or when it prevents
misunderstanding or error, and never to restate the heading.

## When to ask
One rule, everywhere: ask only when two readings would produce materially different work and you cannot pick with a stated assumption. Otherwise assume, say so in one line, and proceed. Bug reports never need hand-holding — reproduce, fix, verify.
