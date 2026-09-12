# Consigliere

An orchestrator/worker topology for Claude Code. The root session decides and delegates; every code change happens in a subagent.

What holds that split is a `PreToolUse` hook rather than a prompt. `orchestrator-gate.mjs` denies the root every source edit and every command outside a closed allow-list, so delegation is structural — not a convention the model can talk itself out of halfway through a task. It runs entirely inside Claude Code: no second vendor, no API key, no plugin, no login.

## Why

Authority has to sit where the tools are not. Version 1 ran an advisor whose advice the main loop could take or ignore, and its gate covered only `Edit`, `Write` and `MultiEdit`, so an unconsulted decision still reached the repository through Bash. Version 2 moves the tools instead of adding advice: the root holds the decisions, the subagents hold the write access.

## How it works

```
                        Fable 5.1
                    root / orchestrator
                             |
    +-----------+-----------+-----------+-----------+
    |           |           |           |           |
explorer     reader    researcher     fork       worker
 Sonnet       Haiku       Opus      inherits      Opus
read-only   read-only   read-only    writes      writes
    |           |           |           |           |
    +-----------+-----------+-----------+-----------+
                             |
                          tester
                           Opus
                             |
                         reviewer
                          Fable
                             |
                             v
                        Fable 5.1
                    integrate + verify
```

That tree is not a convention the root is asked to follow. It cannot write source at all, so the only path from a decision to the repository runs through one of those roles. Everything installs under `~/.claude`, or wherever `CLAUDE_CONFIG_DIR` points; [DESIGN.md](DESIGN.md) covers why each piece is shaped the way it is, and you should read it before you change a hook.

## The roles

| Role | Model | Effort | Tools | Writes |
| --- | --- | --- | --- | --- |
| `worker` | opus | medium | Read, Write, Edit, MultiEdit, Bash, Grep, Glob, Skill | yes |
| `tester` | opus | medium | Read, Edit, Bash, Grep, Glob | tests only |
| `explorer` | sonnet | medium | Read, Grep, Glob | no |
| `reader` | haiku | low | Read, Grep, Glob | no |
| `researcher` | opus | medium | Read, Grep, Glob, WebFetch, WebSearch | no |
| `reviewer` | fable | medium | Read, Grep, Glob | no |

`rules/orchestrator.md` ships with the package and holds the rest: what the root owns, the six-part contract every delegation carries, what a subagent escalates instead of deciding, and the five-field report each one returns.

## What's installed

| Hook | What it does |
| --- | --- |
| `orchestrator-gate.mjs` | denies the root's source edits and every command outside the read-only, verifier, git and gh allow-lists |
| `read-gate.mjs` | denies the root a `Read` over 350 lines without `limit`, routing the question to `reader` |
| `review-tier.mjs` | reads a diff and prints the review effort tier: `none`, `medium`, `high`, `xhigh` |
| `git-discipline.mjs` | the branch, the conventional subject, the review → `/cpr` order, leased force-pushes |
| `commit-language.mjs` | blocks a `git commit` or `gh pr create` whose message reads as Turkish |
| `comment-ratio.mjs` | nudges when an edit lands more comment lines than code |
| `plan-capture.mjs` | copies an approved plan-mode plan into `plans/`, numbered and indexed |
| `update-check.mjs` | one line at session start when a newer tag exists upstream |

- **Rules:** `orchestrator.md`, the behavioral spec Claude reads every session, and `coding-discipline.md` — minimum code, surgical edits, comments as a last resort, plain repo prose.
- **Skills:** `shadcn`, `grilling` with `/grill-me`, `systematic-debugging`, `implement-review-verify`, `/consig-upgrade`, `/yagni`, `/wizard`.

## Requirements

- **Claude Code 2.1.267 or newer** (ships Node). That's it. Older builds dropped the `effort:` line on the models these agents name, so the ladder read as configured and ran flat. `node doctor.mjs` warns when the CLI it finds is below that.
- **macOS, Linux, or Windows.** Every hook is Node and every installed hook command is `node "<absolute path>"`, so nothing here needs bash. The test suite runs on all three in CI.
- *Optional, only for `--with-workflow`:* the **ralph-loop plugin** — `/plugin install ralph-loop@claude-plugins-official`.

## Install

```bash
git clone https://github.com/anilsoylu/consigliere.git && cd consigliere && node install.mjs
```

The installer is idempotent. It backs up `settings.json` and any file it would overwrite (`.consigliere.bak`), merges its hooks without touching yours, and writes the settings below. Restart Claude Code afterward: the agent registry is read at startup, so the six roles do not exist until the next `claude`.

```json
{
  "env": {
    "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING": "1",
    "MAX_THINKING_TOKENS": "31999",
    "CLAUDE_CODE_DISABLE_1M_CONTEXT": "1",
    "CLAUDE_CODE_NO_FLICKER": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_DISABLE_ADVISOR_TOOL": "1"
  },
  "includeCoAuthoredBy": false,
  "alwaysThinkingEnabled": true,
  "model": "claude-fable-5-1",
  "subagentPromptCacheTtl": "1h",
  "maxEffortLevel": "xhigh"
}
```

Those are filled in **only where you have no value of your own**, and the uninstaller reverts none of them, because a filled gap is indistinguishable from a choice later. [DESIGN.md](DESIGN.md#the-recommended-settings) says what each key buys and which three env keys are deliberately left empty.

`node doctor.mjs` byte-compares every installed file against this repo; `--probe` adds one short Haiku run that verifies the gate's assumption against the Claude Code you have; `--json` is machine-readable. It reports a file you customized rather than flagging it, and exits non-zero only for hard failures such as an unusable `settings.json`; an incomplete install is a warning you fix by re-running the installer.

## Optional extras

| Extra | What it adds | How |
| --- | --- | --- |
| Workflow rule | `workflow.md` and the `ralph-protocol` skill: bounded execution loops, `tasks/todo.md` plans, a verifier hierarchy, plus the `/clean`, `/pr-update`, `/cpr`, `/pr-ready`, `/optimize` and `/perf` handoff skills | `node install.mjs --with-workflow` |
| Merge-readiness graph | `/merge-readiness`: four lenses read the diff in parallel, then every finding goes to a judge that did not write it and is told to refute it. Up to 13 agents a run, so nothing routes here on its own | `node install.mjs --with-merge-readiness` |
| Release allow rules | eight `Bash(...)` entries in `permissions.allow` so an unattended release is not stopped at its first push — see [Auto mode](#auto-mode) | `node install.mjs --with-release-permissions` |
| implement-review-verify | one contract as a graph: a worker implements, a reviewer and a tester judge at one barrier, one fix round closes the findings. Five agents at most | ships by default |

## Auto mode

Consigliere ships no `autoMode` block. Claude Code's classifier reads the same instruction files Claude does, so the rules this package installs are already policy; restating them under `autoMode` would be a second, drift-prone encoding of one policy.

What the rules cannot express is your infrastructure, and that is yours to write in `~/.claude/settings.json`. Start with `environment`, the only field that clears the `hard_deny` exfiltration rule. Keep the literal `"$defaults"` in every list. Reach for `allow` last, since an entry there is a mandatory exception that overrides matching soft denies. `claude auto-mode defaults`, `config` and `critique` print the built-in rules, what you actually get, and the ambiguous entries in your own.

## Updating

```bash
cd consigliere && git pull && node install.mjs
```

Or type `/consig-upgrade`, which runs that in the clone the state file records, then the doctor, and reports what changed. Re-running the installer is the whole update: the optional assets you opted into are recorded in the state file and reinstalled every run.

If you changed an installed file on purpose, add it to `"pins": ["agents/reviewer.md"]` in `~/.claude/.consigliere-state.json` and the installer will leave it alone. Paths are relative to the config dir. `install.mjs` prints a line for each file it kept and `node doctor.mjs` counts a pinned file as a pass rather than drift. Without a pin, each upgrade restores this repo's copy over yours and leaves a `.consigliere.bak`. `uninstall.mjs` ignores `pins` and removes everything it installed.

## Uninstall

`node uninstall.mjs` strips only its own hook entries from `settings.json` and leaves your backups in place. It does not revert the recommended settings, and it deletes an installed file only while that file is still byte-identical to this repo's copy — edit one and the uninstaller keeps it and tells you.

## Limits

- **Fable availability:** on a plan that can't reach Fable, Claude Code silently falls back to the inherited model — everything keeps working, but the decision and the verdict come from the same model as the code. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` and `CLAUDE_CODE_SUBAGENT_MODEL` override `model:` in every agent file, so leave them unset; `node doctor.mjs` warns when either is set. See [Requirements](#requirements).
- **The gate is a boundary, not a sandbox.** It reads the command text, so it stops the root's mistakes rather than a determined bypass; a worker holds every tool the root gave up.
- **Two skills still need a POSIX shell:** `wizard` generates bash around `template.sh`, and `systematic-debugging` bisects test pollution with `find-polluter.sh`. On Windows, run those two under Git Bash or WSL.
- **The auto-mode classifier can still deny a push, merge or tag.** The gate allowing a command is not the classifier allowing it; `--with-release-permissions` writes the rules that clear it.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The vendored skills below keep their upstream MIT terms.

| Skill | Upstream | What changed here |
| --- | --- | --- |
| `shadcn` | [shadcn-ui/ui](https://github.com/shadcn-ui/ui), MIT | the files under its `rules/` are modified |
| `clean`, `cpr`, `pr-update`, `pr-ready`, `perf` | [OutThisLife/brooklyn-skills](https://github.com/OutThisLife/brooklyn-skills), MIT | dropped references to sibling skills this package doesn't ship; `perf` gained the routing line to `/optimize` |
| `grilling`, `grill-me` | [mattpocock/skills](https://github.com/mattpocock/skills), MIT | a plain-markdown question format, and the handoff into the delegation contract |
| `wizard` | [mattpocock/skills](https://github.com/mattpocock/skills), MIT | three places: one paragraph on what may be handed to a human at all, a step 1 that reads key names instead of live secrets, and a `template.sh` that single-quotes values into `.env` and unquotes them back out |
| `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers), MIT | four places: a Phase 1 that demands a failing-then-passing command before any Phase 2, grep-tagged debug instrumentation, a ranked 3-5 hypothesis Phase 3, and a Phase 4 that sends the same error back to the root after two failed fixes; plus two `superpowers:*` references swapped for the equivalent `coding-discipline.md` rules |
| `optimize` | original to this repo | — |
