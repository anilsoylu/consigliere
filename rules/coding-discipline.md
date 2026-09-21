# Coding Discipline

## Simplicity
Minimum code that solves the problem. No speculative abstraction, no unrequested configurability, no error handling for impossible cases. If you wrote 200 lines and it could be 50, rewrite it.
Before writing new code, look in this order: what the project already has, the standard library, a dependency already installed, and only then new code. A new dependency needs a sentence on why the first three fell short.

## Comments
Only add comments as a last resort for weird cases. Prefer short comments.
Default to none. A comment earns its line by saying **why** — the constraint, the rejected alternative, the bug it prevents. Never what the code already says. One line; two only when the reason genuinely needs it. If the explanation is longer than the code it sits on, it belongs in the commit message or the README, not the file.
Same rule for prose you write into the repo: a docstring restating the signature, a test name explaining itself, a plan file narrating what a diff already shows. Every one of them is read into context on every future session.

## Repo prose
README, design docs, PR bodies, commit messages: plain declarative sentences. Nothing written for rhythm — no pull-quote opener, no "not X, but Y", no list padded to three items, no one-line paragraph that only sets up the next one.

## Surgical edits
- Touch only what the request requires. Don't refactor, reformat, or "improve" adjacent code.
- Clean up orphans **your** changes created (unused imports, dead vars). Leave pre-existing dead code alone — mention it instead.
- Remove the implementation you replaced. Keep an old path only when the user asked for compatibility.

## Verifiable goals
Turn the task into something you can check, then loop until it passes:
"fix the bug" → write a failing test first, then make it pass. Never call it done without running the verifier.
A throwaway script that proved a fix does not become a test file; a test earns its place by guarding a behaviour or a regression.
After a bug fix, repeat the reporter's steps as reported, not only the test you wrote; the test encodes your reproduction, not theirs.

## UI copy
Do not add subtitles, helper text, or descriptive copy beneath headings, labels, cards,
or settings by default. Prefer one concise, self-explanatory heading or label. Add
supporting copy only when the user explicitly asks for it or when it prevents
misunderstanding or error, and never to restate the heading.
A UI change is done when the empty, loading and failure states are handled, not only the one with data.

## When to ask
This governs clarification. Ask only when two readings would produce materially different work and you cannot pick with a stated assumption; otherwise assume, say so in one line, and proceed. Bug reports never need hand-holding — reproduce, fix, verify.

Authorization is a separate question and `workflow.md` owns it. An irreversible or outward-facing action, a `[Self-Modification]` denial, and a write to a different repo each require their ask no matter how unambiguous the request was — those asks are not clarification and this rule does not suppress them.
