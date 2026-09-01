# Changelog

Releases are plain `git tag v<major>.<minor>.<patch>`; `manifest.mjs` carries the same
number and `update-check.mjs` compares the two. Entries before this file existed were
reconstructed from the tag history.

## Unreleased

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
  fail-open are unchanged; the ones that hid a failed flag or state write now print to
  stderr, which `claude --debug` surfaces.

### Added
- A release guard in CI: pushing a `v*` tag fails when it disagrees with
  `manifest.VERSION`.
- The doctor warns when `CLAUDE_CONFIG_DIR` points elsewhere and an earlier install is
  still sitting in `~/.claude`. Reported only — it removes nothing.
- `package.json` (private, not published), `CHANGELOG.md`, `SECURITY.md`.

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
