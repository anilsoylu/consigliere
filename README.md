# Consigliere

An orchestrator/worker topology for Claude Code: **Fable 5.1 decides, Claude Opus executes.**

The root session plans the work, decomposes it, and writes a contract for each piece. It never edits a file and never runs a command. Every code change, shell command and remote action happens in an Opus subagent. A hook enforces the split rather than trusting it.

It runs entirely inside Claude Code. No second vendor, no API key, no plugin, no login.

## Why

Version 1 ran an advisor/executor loop. The advisor produced advice and the main Opus loop chose whether to follow it, so authority stayed where the code was written. `advisor-gate.mjs` held only `Edit`, `Write` and `MultiEdit`, which left Bash, remote servers and every architectural decision ungated — nothing stopped the main loop from proceeding unconsulted.

Version 2 inverts that. The most capable model holds the decisions and the weaker one holds the tools. The root cannot write source, so a decision it did not make cannot reach the repository through it, and a subagent that hits a decision has to hand it back.

## How it works

```
your prompt
   → the root decomposes it and writes a contract per piece   ← Fable 5.1, decides only
   → explorer and researcher answer what the decision needs   ← read-only
   → worker and tester carry out each contract                ← Opus, holds every tool
   → reviewer reads the diff on a fresh context               ← Fable 5.1, no rationale
   → done
```

Everything installs under `~/.claude` — or wherever `CLAUDE_CONFIG_DIR` points, which the installer, the uninstaller, the doctor and every hook follow. [DESIGN.md](DESIGN.md) covers why each piece is shaped the way it is; read it before you change a hook.

**The roles**

| Role | Model | Effort | Tools | Writes |
| --- | --- | --- | --- | --- |
| `worker` | opus | high | Read, Write, Edit, MultiEdit, Bash, Grep, Glob, Skill | yes |
| `tester` | opus | high | Read, Edit, Bash, Grep, Glob | tests only |
| `explorer` | opus | medium | Read, Grep, Glob | no |
| `researcher` | opus | medium | Read, Grep, Glob, WebFetch, WebSearch | no |
| `reviewer` | fable | medium | Read, Grep, Glob | no |

`worker` and `tester` return to the root instead of deciding when a task turns out to need an architectural choice, a breaking API change, a schema or migration change, a new dependency, or a security decision — or when two readings of the requirement produce different code.

Every report is capped at 40 lines. `worker` and `tester` return five fields: what changed, the files touched, the verifier and its exit code, the confidence, and what was left out of scope. Raw output goes to a log file the report points at, because the root reads each report into the one context that has to last the whole task.

`SendMessage` addresses an agent by name, so every `worker` and `tester` spawn carries a `name:` of its own, `w-<task>` and `t-<task>`. Follow-up work for one already engaged goes back to that name, which resumes it with the history it already has. A fresh spawn is for a different role, or for `reviewer`, where the clean context is the point.

**The hooks**

- `orchestrator-gate.mjs` — denies the root's source edits and every mutating command.
- `review-tier.mjs` — reads a diff and prints the review effort tier: `none`, `medium`, `high`, `xhigh`.
- `update-check.mjs` — one line at session start when a newer tag exists upstream.
- `commit-language.mjs` — blocks a `git commit` or `gh pr create` whose message reads as Turkish.
- `git-discipline.mjs` — the branch, the conventional subject, the `/clean` → review → `/pr-update` order, leased force-pushes, unfiltered verifiers, and the rules again after a compaction.
- `comment-ratio.mjs` — nudges when an edit lands more comment lines than code.
- `plan-capture.mjs` — copies an approved plan-mode plan into `plans/`, numbered and indexed as an `improve` plan.

**The rules**

- `orchestrator.md` — the behavioral spec Claude reads every session: what root owns, the five roles, the six-part contract, parallelism, escalation, review.
- `coding-discipline.md` — minimum code, surgical edits, comments as a last resort, plain repo prose.

**The skills**

- `shadcn` — shadcn/ui's own skill, model-invoked, carrying this repo's edits to its rules.
- `grilling` and `/grill-me` — a planning interview that settles open decisions before the work is decomposed.
- `/consig-upgrade` — pulls the clone, reinstalls, runs the doctor, reports what moved.
- `/yagni` — a deletion pass: make the code smaller without making it do less.
- `/wizard` — writes a bash script for the steps only a human can take.
- `systematic-debugging` — four phases, and no fix proposed before the root cause is found.
- `implement-review-verify` — one bounded contract as a graph: worker, then reviewer and tester at once, then one fix round.

## The gate

Claude Code puts an `agent_id` in the hook payload only when the hook fires inside a subagent; on the main thread the field is absent. `orchestrator-gate.mjs` reads that field, exits immediately when it is present, and otherwise applies the root's restrictions.

This cannot be a `permissions.deny` rule. Deny rules apply to subagents too, so the same entry that stopped the root would stop every worker it delegates to.

On `Edit`, `Write` and `MultiEdit` the gate denies files ending in a source or config extension: `ts tsx js jsx mjs cjs py go rs rb php java kt swift c h cpp hpp cc vue svelte sql sh json yaml yml toml`. Markdown, plain text and everything else pass, as does any path inside the config directory, the OS temp directory, `/tmp`, `~/Desktop`, or any `/.claude/` — so plans, notes and scratch work stay open to the root.

On `Bash` it fails closed: a command it cannot parse is denied, because a restriction that waves through what it does not understand is not a restriction. Denied unconditionally are redirects (`>`, `<`), command substitution (backticks and `$(…)`), and an inline variable assignment before the command. Then each segment of the command — split on `;`, `&&`, `||`, `|`, `&` and newlines, with quoted spans masked so `jq '.a | .b'` stays one segment — has to name an allowed program:

- `ls cat head tail wc file stat du df find grep rg sort uniq cut tr echo pwd which env date jq tree basename dirname realpath readlink diff`
- `git status diff log show blame ls-files rev-parse merge-base describe`, plus `git branch`/`git tag` when every argument is a listing flag and `git stash list`/`git stash show`
- `gh pr view|list|diff`, `gh issue view|list`, `gh repo view`, `gh run view|list`, and `gh api` only without a request body and only with `GET`

Options that turn an allowed command into a writer or a launcher are denied by name: `sort -o`/`--output`/`--compress-program`, `tree -o`, `git --output`, `find -fls`/`-fprint`/`-fprintf`, `rg --pre`, `find -exec`/`-execdir`/`-delete`/`-ok`/`-okdir`, and `env` used to run a program rather than print the environment.

Deleting `rules/orchestrator.md` turns the gate off. It checks for that file before it reads the payload, so a disabled gate never denies anything.

## Where the topology comes from

The shape follows [donvito/codex-astra-luna-orchestrator](https://github.com/donvito/codex-astra-luna-orchestrator), which does the same thing for Codex. One difference is deliberate: upstream reviews with Astra on low reasoning in a read-only sandbox, and here the reviewer is Fable. Verdict quality is the one place the strongest model pays for itself, and the fresh context is what keeps it honest — a reviewer spawned with the diff and no rationale cannot anchor on the plan that produced it.

## Keeping plan-mode plans

Plan mode already writes its plan to a file, at `~/.claude/plans/<slug>.md`. That location is machine-local, is not partitioned by project, and the slug names no repo, so the plan is invisible to git, to a reviewer, and to you on another machine.

`plan-capture.mjs` copies it beside the code it plans, as an `improve` plan. Every approved plan lands in `plans/` at the repo root as `NNN-<slug>.md`, numbered after the highest plan already there, with its row appended to the status table in `plans/README.md` — created from `improve`'s template when absent. Priority, Effort and Depends on come from the plan's own Status block; the status starts at `TODO`. A repo whose `plans/` already means something else uses `advisor-plans/` instead, which is the same escape hatch `improve` takes.

The hook creates `plans/` when it is absent, at the moment it has a plan to write — an ExitPlanMode it cannot capture leaves your tree untouched. It is the only hook here that writes into your working tree, and an earlier version required you to create the directory first, which failed the way silent opt-ins do: the plan for this feature was dropped, in this repo, with nothing said. `improve` expects `plans/` committed, since the index is shared across sessions and reconciled between them; a repo that would rather not commit captures puts `plans/` in `.gitignore`, which is what this repo does, its captures being the hook's own output under test. Outside a git repo nothing is created and nothing is written.

One numbering, one index, so `/improve` continues from where plan mode stopped: `reconcile` refreshes a captured plan like any other, `execute` hands it off. A re-plan in the same session reuses the slug but takes the next number, so it never overwrites the plan it replaces.

`ExitPlanMode` carries no plan text; it signals that the file is ready. The hook reads the path from the last `plan_mode` attachment in the session transcript. When there is no attachment, or the file it names is gone, the hook exits silently rather than blocking the turn. A rejected plan leaves nothing behind: `PostToolUse` fires only after a tool completes, and rejecting a plan is a permission denial.

## Requirements

- **Claude Code** (ships Node). That's it.
- **macOS, Linux, or Windows.** Every hook is Node and every installed hook command is `node "<absolute path>"`, so nothing here needs bash — Claude Code on Windows runs PowerShell or CMD just as often. The test suite runs on all three in CI.
- *Optional, only for `--with-workflow`:* the **ralph-loop plugin** — `/plugin install ralph-loop@claude-plugins-official`.

The root is meant to run Fable 5.1 and the reviewer pins `model: fable`. If your account can't reach Fable, Claude Code falls back to the inherited model rather than failing the request, which costs you the independent read on both ends. Change the `model:` line in `~/.claude/agents/reviewer.md` to something your plan reaches and the fallback stops being silent.

## Install

```bash
git clone https://github.com/anilsoylu/consigliere.git
cd consigliere
node install.mjs
```

Or hand the repo to Claude Code and say: *"run `node install.mjs` in this repo."*

The installer is idempotent — re-running it changes nothing. It backs up `settings.json` and any agent, rule, hook, or skill file it would overwrite (`.consigliere.bak`), and merges its hooks without touching your existing ones.

Restart Claude Code (plain `claude`) afterward. This is not optional on a fresh install or an upgrade from v1: the agent registry is read at startup, so the five roles do not exist until the next `claude` and a delegation names a subagent that is not there. Hooks and rules are read per invocation and take effect immediately.

### What it writes into settings.json

Besides its hook entries, the installer fills in the settings this topology is tuned against — **only where you have no value of your own**. A key you already set is yours, even when it disagrees; the uninstaller doesn't revert any of them, because a filled gap is indistinguishable from a choice later.

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
  "subagentPromptCacheTtl": "1h"
}
```

`model` is the one that decides whether any of this pays off: the root only decides and delegates, which is the work worth spending the strongest model on. Adaptive thinking is off and the thinking budget is fixed rather than inferred, so a decision that looks routine does not get a shallower pass. `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` keeps Claude Code's own built-in advisor tool out of the loop, where it would consult a second model server-side on top of the roles here; set the key to `""` to get `/advisor` and `advisorModel` back. The 1M context window is off on purpose: the design keeps each subagent's input small and deliberate, and a bigger window works against that.

`subagentPromptCacheTtl` holds a subagent's prompt cache for an hour instead of the default five minutes, which a delegation waiting on a sibling routinely outlives; re-delegating to the same agent after that pays for the prompt again.

Earlier versions filled `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and this one does not. With it set, a named spawn becomes a teammate: the agent file is appended to the default system prompt instead of replacing it, and effort is inherited from the root. That leaves the reviewer reading a diff at the root's effort with the default prompt still under it, which is neither the fresh context nor the effort tier it was spawned for. The installer never overwrites a value you already have, so it and the doctor both warn while the key is still set.

Three env keys are deliberately not filled, because each one overrides a per-role setting for every agent at once. `CLAUDE_CODE_EFFORT_LEVEL` overrides the `effort:` line in every agent file; the root's effort belongs to `/effort`. `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` override the `model:` line, which collapses Opus workers and a Fable reviewer into one model. The installer warns about the first and the doctor warns about all three.

Every value takes effect on the next `claude` start, and `settings.json` is backed up before the installer touches it. Run `node doctor.mjs` and it reports which of these have no value set. Delete any you disagree with and re-running the installer puts them back, because an absent key reads as a gap. Set it to your own value if you want it to stick.

To verify an install without changing anything:

```bash
node doctor.mjs
```

The doctor byte-compares the installed agents and hooks against this repo's copies — an existing but edited hook is not the hook you think is running — and checks the default rules, the `settings.json` hook entries, the recommended settings, the root model, and the yagni, shadcn, wizard, grilling and upgrade skills. A file you customized is reported, not flagged. It exits non-zero only for hard failures such as an unusable `settings.json` or missing repo assets; incomplete installs are warnings you fix by re-running the installer.

A missing agent file is called out specifically, because the gate denies the root's source edits and names those roles as the way through: installed without them, you have a lock with no key.

For machine-readable output:

```bash
node doctor.mjs --json
```

### Optional: the workflow rule

```bash
node install.mjs --with-workflow
```

This adds a third rule, `workflow.md`, plus the `ralph-protocol` skill it defers to: a bounded execution loop on top of the topology. Plans live in `tasks/todo.md` with a fixed shape (goal, acceptance criteria, verification commands, attempts, review), a verifier hierarchy decides what counts as proof, and long jobs run through `/ralph-loop` capped at 8 iterations with an explicit `RESULT: VERIFIED_COMPLETE` / `RESULT: BLOCKED` stop line. That proof is never read through a pipe: one verifier per call, output redirected to a file, because `tail` or `grep` on the end of a run hands back the filter's exit status instead of the verifier's — a red run reads as green.

The rule stays short on purpose — the entry conditions, iteration discipline, verifier hierarchy, and stop conditions live in the skill, which Claude loads when Ralph actually comes up instead of on every session.

The same flag ships the three skills the rule names for the git handoff: `/clean` polishes your own diff by hand, `/pr-update` opens or refreshes the PR, `/pr-ready` unblocks one that's already open. What the rule adds is their order — clean, *then* the review, *then* the PR — because cleaning rewrites the diff, so a review that ran before it judged code that no longer exists. It also tells you never to run the `cpr` shortcut, which fuses the polish and the PR into one pass and leaves no gap for the review; that skill is not shipped here. Upstream is [brooklyn-skills](https://github.com/OutThisLife/brooklyn-skills) (MIT) — the copies here drop the handoffs to sibling skills this package doesn't install.

It also ships the optimization pair the rule wires into that order. `/optimize` is an exact-parity speed rewrite of a named routine: characterization test first, baseline timing, then shorter and faster with bitwise-identical behavior, and before/after numbers are required. It fires unprompted when clean's diff read surfaces a compute-heavy routine — data loops, math kernels, parsers, media processing. Detection rides the read clean already does, so it costs no extra pass. Unattended runs are bitwise-only: if parity can't hold, the rewrite is reverted rather than shipped with a tolerance nobody approved. `/perf` covers the other direction, "why is this slow" with no known target: baseline, profile, fix the real hot path, re-measure. Each routes the other's case to it by name, so they install together. perf's upstream is brooklyn-skills (MIT); optimize is original here.

It's opt-in because it's opinionated and because the Ralph half needs a plugin Consigliere doesn't ship — `/plugin install ralph-loop@claude-plugins-official`. Install it without the plugin and you get the planning and verification discipline, just not the `/ralph-loop` and `/cancel-ralph` commands; the installer warns and continues.

### Optional: the merge-readiness review graph

```bash
node install.mjs --with-merge-readiness
```

The `reviewer` role gives you one verdict. This gives you a graph. Run `/merge-readiness` on a branch and four lenses — security, data-migration, api-contract, perf — read the diff in parallel, then every finding they produce is handed to a judge that didn't write it and told to refute it.

Two rules hold it up. **The judge is never weaker than the author:** tier 1 is the same model at higher effort, tier 2 escalates the model instead and steps effort back down, so you never pay for both axes at once. **The judge doesn't see the author's reasoning:** it gets the claim and the hunk and nothing else, because a judge that reads the justification anchors to it and approves.

The verdict on whether the tree is sound comes from your own verifier's exit code, not from a model's opinion — if the baseline is already red, the run stops instead of reviewing a broken tree. Nothing in the graph writes code; every judging node is schema-bound to return a verdict, and fixes happen afterwards in a worker where you can see them.

It costs up to 13 agents a run, so `review-tier.mjs` only routes `xhigh` here; routine diffs stay on a single `reviewer` spawn. Reach for it by hand on a `high` diff when it's big enough that one reviewer will miss something and you can say why.

### Optional: the release allow rules

```bash
node install.mjs --with-release-permissions
```

Adds eight `Bash(...)` entries to `permissions.allow` in your `settings.json` so an unattended release is not stopped by the auto-mode classifier at its first push. See [Auto mode](#auto-mode) for what it writes and why it is off by default.

### The implement-review-verify workflow

Ships by default, no flag. An implement task normally costs the root four turns: spawn the worker, wait, spawn the reviewer, wait, spawn the tester, wait, then decide. Every wait re-reads the whole root context to advance one step, and the reviewer and the tester never overlap even though neither needs the other's answer.

Hand the contract to this skill instead. A `worker` carries it out, a `reviewer` and a `tester` judge the result at one barrier, and a single fix round closes the ADOPT findings and a red verifier. Five agents at most. The fix round never repeats: two failed attempts on the same error mean the approach is wrong, and that is the root's call rather than the graph's.

Every stage names an `agentType` instead of a model and an effort, so each one runs the role as your agent files define it. Change `worker.md`'s `effort:` line and the skill follows without being edited. The reviewer has no shell, so the worker writes the diff to a patch file and the reviewer judges that, plus the changed files for context and nothing else from the worker's report.

Reach for it when the work is one delegable change whose contract is already written. It is not the handoff chain and it opens no PR: `clean`, the review tier and `pr-update` still run over the whole branch in the main loop.

## Auto mode

Consigliere ships no `autoMode` block, on purpose.

Claude Code's auto-mode classifier reads the same instruction files Claude does, so the rules this package installs are already policy — it will block a call and cite one of them back to you as your own standing rule. Restating that doctrine under `autoMode` would be a second, drift-prone encoding of one policy, and `claude auto-mode critique` flags redundant rules on sight. Exact, mechanical rules belong in a hook anyway; the classifier is for judgment calls a pattern can't express.

What the rules genuinely cannot express is your infrastructure, and that is yours to write. It goes in `~/.claude/settings.json` — the classifier does not read `autoMode` from project settings:

- `environment` is where to start and usually the only field you need. It is also the only one that clears the `hard_deny` exfiltration rule, so a trusted bucket or domain belongs here and nowhere else.
- Keep the literal `"$defaults"` in every list. Dropping it takes ownership of 60-odd built-in denies that you then maintain forever.
- Reach for `allow` last. An entry there is a *mandatory* exception that overrides matching soft denies, so a vague one disables protections you never went looking for.

`claude auto-mode defaults` prints the built-in rules, `config` prints what you actually get, and `critique` reads your own entries back and names the ambiguous ones.

Release commands are the one case where `allow` earns its place, and `node install.mjs --with-release-permissions` is how you take it. It appends `Bash(git push:*)`, `Bash(git tag:*)`, `Bash(gh pr create:*)`, `Bash(gh pr ready:*)`, `Bash(gh pr edit:*)`, `Bash(gh pr merge:*)`, `Bash(gh pr reopen:*)` and `Bash(gh release create:*)` to `permissions.allow`, keeping every entry already there. Without the flag the installer writes no `permissions` block at all, because an allow entry is a mandatory exception that overrides matching soft denies and that is your call to make, not this package's. What it buys is an unattended release that finishes: a classifier denial mid-run leaves a branch pushed and a tag not. What it does not buy is a free hand with git. `git-discipline.mjs` still blocks bare `--force` and commits straight to master underneath it, in every thread, because a hook reads the command rather than asking a model about it. The uninstaller leaves the entries alone once written.

## Updating

```bash
cd consigliere && git pull && node install.mjs
```

Or type `/consig-upgrade`, which runs exactly that in the clone the state file records, then the doctor, and reports what changed.

Re-running the installer is the whole update — no flags needed the second time. The optional assets you opted into are recorded in the state file and reinstalled on every run; to drop one, run `node uninstall.mjs`; leaving the flag off does nothing. The exception is `--with-release-permissions`, whose entries the uninstaller leaves in `settings.permissions.allow` for you to remove by hand. You don't have to notice on your own: releases are plain `git tag v<major>.<minor>.<patch>`, `install.mjs` records the version it wrote into `~/.claude/.consigliere-state.json`, and `update-check.mjs` compares the two.

The check never blocks and never runs in the foreground. At session start the hook reads a cached answer and exits; at most once a day it hands the network work to a detached child that runs `git ls-remote --tags origin` in the clone you installed from and writes the result for the *next* session. Offline costs nothing, a fork checks its own origin rather than this one, and the clock advances whether or not the lookup succeeded — a failing check waits out the day like a successful one.

That `git ls-remote` is the only thing this package ever sends anywhere: one tag listing, to the remote of a repo you already cloned. It stands down entirely under `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` or `CONSIGLIERE_NO_UPDATE_CHECK=1`. If you set either — and this repo's own recommended env sets the first — use `node doctor.mjs` instead, which makes the same comparison on demand and blocks while it does, because blocking in a CLI you ran on purpose is fine.

## Uninstall

```bash
node uninstall.mjs
```

Strips only its own hook entries from `settings.json` — an unrelated hook sharing the same block survives — and leaves your backups in place. It does not revert the recommended env keys, the `model` setting or the other settings, and does not touch plugins: once a value is in your settings.json there is no way to tell a gap the installer filled from one you kept on purpose. The pre-uninstall backup is right there if you want the old file. Any file it placed is deleted only while it's still byte-identical to this repo's copy: agents, hooks, rules, and skills alike. Edit one and the uninstaller keeps it and tells you, rather than throwing away your version; the hook stays on disk but is no longer wired up.

## Upgrading from v1 (advisor/executor)

Run the installer:

```bash
cd consigliere && git pull && node install.mjs
```

It removes what v1 shipped and this version does not: `hooks/advisor-inject.mjs`, `hooks/advisor-gate.mjs`, `hooks/advisor-mark.mjs`, `agents/advisor.md`, and `rules/advisor-executor.md`. Each is backed up before it goes, because this version ships no copy to byte-compare against, so "did you edit it?" is a question that can no longer be answered. The matching hook entries are pruned from `settings.json` in the same run.

Restart Claude Code afterward. The agent registry loads at startup, so until you do, the rule tells the root to delegate to roles that do not exist yet.

Two things carry over. An `advisor-plans/` directory keeps working: `plan-capture.mjs` still prefers it over `plans/` when it is there. And `~/.claude/hooks/advisor-watchdog.sh`, left over from the Codex Sol era before v1, is in no manifest, so neither the installer nor the uninstaller touches it; the installer says so if it finds one, and `rm` it when you want it gone.

The Sol version — the advisor as Codex GPT-5.6 driven over the Codex plugin by a bash watchdog — is tagged [`v1-sol`](https://github.com/anilsoylu/consigliere/releases/tag/v1-sol) and still installs with `git checkout v1-sol && node install.mjs`.

## Limits

- **Fable availability:** the root is meant to run Fable 5.1 and the reviewer pins `model: fable`. On a plan that can't reach it, Claude Code silently falls back to the inherited model — everything keeps working, but the decision and the verdict come from the same model as the code. See [Requirements](#requirements). `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` and `CLAUDE_CODE_SUBAGENT_MODEL` override `model:` in every agent definition, so leave them unset; `node doctor.mjs` warns when either is.
- **The gate is a boundary, not a sandbox.** It reads the command text, so it stops the root's mistakes rather than a determined bypass; a worker holds every tool the root gave up.
- **Two skills still need a POSIX shell:** `wizard` generates bash scripts around `template.sh`, and `systematic-debugging` bisects test pollution with `find-polluter.sh`. Nothing in the hook chain does — on Windows, run those two under Git Bash or WSL.
- **`--with-merge-readiness`:** the skill drives Claude Code's Workflow tool, so nothing fires automatically — you run `/merge-readiness` and Claude asks before spawning the graph. Its tier-2 judge pins Fable for the same reason the reviewer does, with the same fallback.
- **The auto-mode classifier can still deny a push, merge or tag from a worker.** The worker reports the command and the run stops until the user adds the allow rules, which `--with-release-permissions` writes.

## License

MIT. See [LICENSE](LICENSE).

Bundled skills and what changed in them:

| Skill | Upstream | What changed here |
| --- | --- | --- |
| `shadcn` | [shadcn-ui/ui](https://github.com/shadcn-ui/ui), MIT | the files under its `rules/` are modified |
| `clean`, `pr-update`, `pr-ready`, `perf` | [OutThisLife/brooklyn-skills](https://github.com/OutThisLife/brooklyn-skills), MIT | dropped references to sibling skills this package doesn't ship; `perf` gained the routing line to `/optimize` |
| `grilling`, `grill-me` | [mattpocock/skills](https://github.com/mattpocock/skills), MIT | a plain-markdown question format, and the handoff into the delegation contract |
| `wizard` | [mattpocock/skills](https://github.com/mattpocock/skills), MIT | three places: one paragraph on what may be handed to a human at all, a step 1 that reads key names instead of live secrets, and a `template.sh` that single-quotes values into `.env` and unquotes them back out |
| `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers), MIT | four places: a Phase 1 that demands a failing-then-passing command before any Phase 2, grep-tagged debug instrumentation, a ranked 3-5 hypothesis Phase 3, and a Phase 4 that sends the same error back to the root after two failed fixes; plus two `superpowers:*` references swapped for the equivalent `coding-discipline.md` rules |
| `optimize` | original to this repo | — |
