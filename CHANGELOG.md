# Changelog

Releases are plain `git tag v<major>.<minor>.<patch>`; `manifest.mjs` carries the same
number and `update-check.mjs` compares the two. Entries before this file existed were
reconstructed from the tag history.

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
