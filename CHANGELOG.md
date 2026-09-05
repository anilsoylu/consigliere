# Changelog

Releases are plain `git tag v<major>.<minor>.<patch>`; `manifest.mjs` carries the same
number and `update-check.mjs` compares the two. Entries before this file existed were
reconstructed from the tag history.

## v1.10.0 — 2026-09-05

### Fixed
- The handoff gate is per task and per PR, not per session. `handoff-<sid>.flag` was written
  once and never cleared, so the first `/clean` of a session opened the gate for every PR
  after it — a live transcript shows nine consecutive PRs opened on one chain. It is now
  cleared on any prompt that is not a short approval, and again once `gh pr create` returns.
- `plan-capture.mjs` creates `plans/` instead of standing down when it is absent. Requiring
  the directory first meant a repo that had not opted in lost its plans in silence, which is
  how the plan for this hook was itself dropped.

### Added
- Four `Bash` denies in `git-discipline.mjs`, each naming the rewrite that clears it: a bare
  `git push --force` (the leased forms pass), `sleep` used to poll, a `timeout` above the
  120000ms default, and a verifier piped into `tail`/`head`/`grep`/`rg`, where the filter's
  exit status hides a red run. The verifier list is bounded and matched per shell segment, so
  `npm test > /tmp/t.log; git log | head` passes.
- `git-discipline.mjs` re-states the workflow rules on `SessionStart` when `source` is
  `compact` or `resume` — the two moments the conversation is rebuilt from a summary, and the
  reported cause of the loop losing them mid-session.
- `hooks/approval.mjs`, one definition of "a short approval, not a new task", shared by the
  advisor gate and the handoff gate so they cannot re-arm on different turns.

## v1.9.0 — 2026-09-05

### Changed
- `plan-capture.mjs` now writes into `plans/` itself, not a `plans/plan-mode/` subdirectory,
  and names the file `NNN-<slug>.md` after the highest plan already there. It appends the
  plan's row to the status table in `plans/README.md`, creating that file from `improve`'s
  template when absent. A repo whose `plans/` is already something else gets
  `advisor-plans/`, the same escape hatch `improve` takes. Captures and `/improve` plans now
  share one sequence and one index, so `reconcile` and `execute` treat them alike.
- The `Plan mode` section of `rules/advisor-executor.md` follows: the plan carries the full
  Status block, since the hook copies Priority, Effort and Depends on into the index row,
  and the drift check comes back. Code excerpts and the commands table stay out, and the
  session no longer writes the index row itself.

## v1.8.0 — 2026-09-05

### Added
- `plan-capture.mjs`, a `PostToolUse` hook on `ExitPlanMode`, copies an approved plan-mode
  plan into `<repo>/plans/plan-mode/` as `YYYYMMDD-HHMMSS-<slug>.md`. It is the only hook
  here that writes into a working tree, so the directory is the consent: without it nothing
  happens. See "Keeping plan-mode plans" in README.md.
- A `Plan mode` section in `rules/advisor-executor.md`. When `plans/plan-mode/` exists the
  plan is written in `/improve`'s sections, minus what that template carries only for a
  cold executor: no code excerpts, no commands table, no drift check, no plan number, no
  index row. It also
  records that the directory does not make `plans/` an unrelated purpose for `/improve`,
  and that `reconcile` does not index it.

## v1.7.0 — 2026-09-04

### Changed
- The injected directive told the executor to consult "before writing code", which reads
  as the first turn. `advisor-gate.mjs` enforces something later and different: it denies
  the first source edit, which comes after the files are read. The two disagreed, and the
  executor follows the directive. The consult contract is the second reason: this loop's
  advisor sees the consult and nothing else, never the transcript, so one written before
  the files are read asks for a verdict on a paraphrase. Step 1 now names the moment the
  gate already enforced, and `rules/advisor-executor.md` carries the same rule.

## v1.6.0 — 2026-09-04

### Added
- `RECOMMENDED_ENV` sets `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`, so `/advisor` is
  unavailable and a configured `advisorModel` is ignored. v1.5.0 only warned about the
  built-in tool in the doctor, which reached the user who ran it by hand. The installer
  fills the key when it is absent; `""` is the value that gets the built-in tool back.

### Fixed
- The doctor resolved env keys shell-first. Claude Code writes each `settings.json` `env`
  entry into the process environment over what the shell exported, so `settings.env` wins
  and `"KEY": ""` is how you unset a stale export. Reading the shell first meant the
  doctor reported an override the running session does not have.
- The `advisorModel` warning fired even when `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` was set,
  so a user who followed the README's own advice was told to fix something already fixed.
  It now reads the key as a flag, so a value like `"0"` no longer counts as disabled.

## v1.5.0 — 2026-09-04

Claude Code 2.1.260.

### Added
- `doctor.mjs` reports an `advisor model` check. It warns when `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`
  is set without `CLAUDE_CODE_SUBAGENT_MODEL` naming Fable, because the flag overrides
  `model: fable` in the agent definition and the `advisor agent` check kept passing while the
  advisor ran as the main model. It also warns when `advisorModel` is set: Claude Code's
  built-in advisor tool and this loop's subagent then both run, so every decision is
  consulted twice, and the built-in one re-reads the whole transcript uncached each call.
- `README.md` gets a section on the built-in advisor tool (`/advisor`, `advisorModel`,
  `--advisor`), and `rules/advisor-executor.md` one line: it is a different advisor, it never
  clears the gate, and `advisor-mark.mjs` does not count it as a consult.

### Changed
- `RECOMMENDED_ENV` drops `ANTHROPIC_CUSTOM_MODEL_OPTION` and `_NAME`. Claude Code 2.1.260
  lists Fable 5.1 in the `/model` picker on its own. A value already in `settings.json` is
  left alone, as the installer always did.
- `RECOMMENDED_ENV` drops `CLAUDE_CODE_EFFORT_LEVEL`. The pin forced every main model to
  `high` and made `/effort` a no-op; the README justified it as keeping the advisor from a
  shallow pass, but the advisor's own frontmatter sets `effort: medium`, and frontmatter
  takes precedence over the env for that agent. Without the pin the main model's effort
  follows `/effort` and its own default.
- `DESIGN.md` notes that on 2.1.260 Fable 5.1's prompt cache covers the context attached
  after tool results, so a continued advisor pays for its earlier Reads once.

## v1.4.7 — 2026-09-03

### Changed
- `RESEARCH NEEDED` covers everything the advisor's three tools cannot reach, not just web
  facts. The advisor has no Bash and no network either, so a verdict can depend on a
  verifier run, a live log or a remote call just as easily as on a current fact, and those
  cases had no handback route. The executor now owes a defined payload back: the question,
  the answer and its source, and what it intends to do; if the work cannot be done, that
  fact goes back instead, so an unattended run cannot stall on an unanswerable question.
  `rules/advisor-executor.md`, `agents/advisor.md`, `hooks/advisor-inject.mjs` and
  `README.md` all carried the old web-only wording and are updated together.
- A verdict carrying an open `RESEARCH NEEDED` opens with `PROVISIONAL`, and on a review it
  precedes the verdict word (`PROVISIONAL FIX-FIRST`). The handback was already described
  before this change and was still skipped in practice: the executor researched the
  question, decided alone and never re-consulted, leaving the advisor's hedge unresolved.
  Enforcing it in a hook is not possible — `UserPromptSubmit` does not fire on a named
  subagent's reply, so no hook sees the verdict text — and a marker in the verdict itself
  survives the executor's own summary of it, which is where the skip happens.
- `hooks/advisor-inject.mjs` spawns the advisor with `name: "advisor"`. The directive
  omitted the name while the rule told the executor to re-consult the same advisor, which
  needs one.

## v1.4.6 — 2026-09-03

### Added
- `rules/coding-discipline.md` carries a `## Repo prose` section. The `## Comments` rule
  already governed whether prose written into the repo earns its place, but nothing
  governed how it reads, so README, design docs, PR bodies and commit messages drifted
  into prose written for rhythm. The section names the four patterns it bans — a
  pull-quote opener, "not X, but Y", a list padded to three items, a one-line paragraph
  that only sets up the next one — rather than asking for plainness in the abstract,
  because a named failure mode is easier to follow than a vague instruction.
  `README.md` and `DESIGN.md` both describe what this rule contains, so both now list it.

## v1.4.5 — 2026-09-03

### Fixed
- `review-tier.mjs` classifies the whole repository even when it is invoked from a
  subdirectory. `git ls-files --others` is scoped to its cwd, so a session working inside a
  monorepo package never saw untracked files elsewhere in the repo, got the rest as
  cwd-relative paths that no root-anchored rule could match, and looked for `.review-tiers`
  in the package instead of the root. Every one of those lowered the tier without an error:
  a diff adding an untracked `lib/stripe-client.ts` printed `none` — review skipped —
  where the same diff from the root printed `xhigh`. The rule documents the invocation with
  no argument at all, which is exactly the case that broke. Now the classifier resolves
  `git rev-parse --show-toplevel` first and runs everything from there; the argument becomes
  any directory inside the repo rather than the root specifically.

## v1.4.4 — 2026-09-03

### Fixed
- `.review-tiers` floors work on paths no source extension covers. The override loop
  matched against the already-filtered source list and ran after an early `none` exit, so
  a rule like `high ^skills/.*\.md$` could never fire — the documented per-project
  mechanism was dead for exactly the repos that need it most, the ones whose shipped
  product is markdown: rules, skills, prompts. Overrides now match every changed path and
  the `none` exit moved below them. `none` means "no source changes and no project floor
  matched"; nothing else moved, and a repo with no `.review-tiers` classifies as before.
- Note the one way this can now cost more: an `xhigh` rule matching a non-source path used
  to be inert on a source-free diff and can now route a markdown-only diff to
  merge-readiness, which is up to 13 agents. Floor prose at `high` unless you mean it.

### Added
- This repo ships its own `.review-tiers`, flooring `rules/`, `skills/` and `agents/`
  markdown at `high`. Those files are the product here and were classifying as `none`,
  so a change to a rule that steers every session in every install got no review at all.

## v1.4.3 — 2026-09-02

### Changed
- The gate's denial says "no consult has run since the last user prompt" instead of
  "for this task yet". Any user message that is not a short ack resets the flag, so the
  old wording was false whenever a consult had run earlier in the same task — and it
  pushed the executor toward the "the hook is broken, stop" branch when the answer was
  to re-consult. The reset itself is unchanged and deliberate: a wrong reset costs one
  re-consult, a wrong keep ships code nobody reviewed. `rules/advisor-executor.md` said
  the same false thing and now matches the hook, which matters more: the rule is loaded
  into every session, so it outranked the deny string whenever the two disagreed.

## v1.4.2 — 2026-09-02

### Fixed
- `/merge-readiness` can run. It told the model to invoke its bundled script through
  `scriptPath`, which the Workflow tool rejects for any file outside a working directory
  — and a skill directory never is one, so the top tier of the review ladder failed for
  every user. It now reads the script and passes the contents as `script`.

## v1.4.1 — 2026-09-01

### Fixed
- The advisor's own verdict no longer closes the gate. A subagent spawned with a name
  returns through a third envelope, `<agent-message from="...">`, which
  `advisor-inject.mjs` did not recognize as machine input — so it cleared the flag the
  consult had just set. Since `rules/advisor-executor.md` tells the executor to name the
  advisor, following the doctrine denied every source edit for the rest of the task, with
  no way back short of a fresh consult.

## v1.4.0 — 2026-09-01

### Fixed
- `CLAUDE_CONFIG_DIR` is now honored by the installer, the uninstaller, the doctor and
  every hook. Previously only `git-discipline.mjs` and `comment-ratio.mjs` read it, so a
  user who set it had files written where Claude Code never looks while the doctor
  reported a healthy install.
- `commit-language.mjs` self-gates on `rules/communication.md` existing, the same way
  `git-discipline.mjs` gates on `rules/workflow.md`. It shipped citing a rule this
  package never installs, so every user but the author got a Turkish-only block
  pointing at a file they did not have.
- Hooks report failures they used to swallow. The catches that were a deliberate
  fail-open are unchanged, and so is `update-check.mjs`'s detached child, which runs
  under `stdio: 'ignore'`; the foreground catches that hid a failed flag or state write
  now print to stderr, which `claude --debug` surfaces.
- The `/consig-upgrade` skill reads its state file from the config dir instead of a
  hardcoded `~/.claude`.
- The installer refreshes a `.consigliere.bak` instead of keeping the first one. A backup
  written by an early install stayed put, so a later install found one already there,
  wrote nothing, and overwrote your edit — the protection switched itself off after a
  single use. `settings.json` is now written once per run, backed up only when the merge
  actually changes it — the context-mode env tuning used to write a second time with no
  backup at all.

### Added
- A release guard in CI: pushing a `v*` tag fails when it disagrees with
  `manifest.VERSION`.
- The doctor warns when `CLAUDE_CONFIG_DIR` points elsewhere and an earlier install is
  still sitting in `~/.claude`. Reported only — it removes nothing.
- `package.json` (private, not published), `CHANGELOG.md`, `SECURITY.md`.

### Changed
- The config-directory rule has one definition, `hooks/config-dir.mjs`, which the hooks
  import as a sibling and `manifest.mjs` re-exports. It installs alongside the hooks
  without registering as one.

## v1.3.1 — 2026-09-01
- Verifier exit codes stay readable: no piping a verifier through `tail`/`grep`, one
  verifier per call.
- The `/model` picker is pinned to Fable 5.1 through `ANTHROPIC_CUSTOM_MODEL_OPTION`.

## v1.3.0 — 2026-08-30
- `git-discipline.mjs` enforces the branch, subject and PR-handoff rules of
  `rules/workflow.md` at the moments they are machine-visible.
- `comment-ratio.mjs` nudges when an edit lands more comment than code.
- `rules/coding-discipline.md` makes comments a last resort rather than a default.

## v1.2.2 — 2026-08-25
- Advisor performance findings are `[ADOPT]` only when the cost is a readable complexity
  class; anything needing a measurement is `[DISCUSS]` at most.

## v1.2.1 — 2026-08-23
- `/consig-upgrade` ships by default, and `update-check.mjs` shows the update notice to
  the user rather than routing it through the model.

## v1.2.0 — 2026-08-23
- Runs on Windows and Linux, not just macOS. Every hook is Node with no shell
  dependency; CI covers all three platforms.

## v1.1.0 — 2026-08-23
- `commit-language.mjs` reads `git -C <dir>` and `git tag`.
- The advisor subagent ships at `effort: medium`.

## v1.0.0 — 2026-08-23
First release of the native-subagent advisor, replacing the Codex Sol watchdog era
(tagged `v1-sol`).

- The advisor is a Claude Code subagent pinned to `model: fable` with `Read`, `Grep`,
  `Glob` and nothing else, so read-only is structural rather than promised.
- `advisor-inject.mjs`, `advisor-mark.mjs` and `advisor-gate.mjs` gate source edits on a
  consult having run for the task; `SendMessage` to a live advisor clears the gate too.
- `review-tier.mjs` classifies a diff as `none|medium|high|xhigh`, with per-repo
  `.review-tiers` floors that can only raise the tier.
- `commit-language.mjs` blocks Turkish commit and PR text.
- `update-check.mjs` announces a newer upstream tag once a day, out of the foreground.
- The installer prunes hook entries it no longer registers, backs up anything it would
  overwrite, and fills the recommended env only where a key is absent.
- Skills shipped by default: `grilling`/`grill-me`, `yagni`, `wizard`,
  `systematic-debugging`, `shadcn`, `consig-upgrade`. Behind `--with-workflow`:
  `ralph-protocol`, `clean`, `pr-update`, `pr-ready`, `optimize`, `perf`. Behind
  `--with-merge-readiness`: the review graph.
- The advisor reads a repo's own standards files before judging a diff, and skips
  findings the project's tooling already enforces.
