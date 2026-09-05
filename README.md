# Consigliere

A second brain for Claude Code: **Fable 5.1 plans, Claude Opus builds.**

The advisor thinks through *how* to do the work — architecture, edge cases, second opinions — but never touches your files. Opus, the main Claude Code loop, writes the code. A gate stops Claude from writing source until the advisor has weighed in.

It runs entirely inside Claude Code. No second vendor, no API key, no plugin, no login.

## Why

One model that plans and builds in the same pass tends to solve the wrong problem confidently. Splitting the roles helps: a planner that only reasons, a builder that only executes. Fable is strong at planning and critique; Opus is strong at disciplined execution. Consigliere wires them together and handles the parts that break in practice — a review that quietly drops half its findings, an advisor that "promises" not to edit but could, a gate that fires on scratch files and teaches you to ignore it.

## How it works

```
your prompt
   → the advisor plans it (Read/Grep/Glob only)      ← the brain
   → you approve
   → Opus implements it                              ← the hands
   → a risk-tiered review of the diff (medium+high: the advisor / xhigh: merge-readiness)
   → done

```

Seventeen pieces, all installed under `~/.claude` — or wherever `CLAUDE_CONFIG_DIR` points, which the installer, the uninstaller, the doctor and every hook follow. [DESIGN.md](DESIGN.md) covers why each one is shaped the way it is; read it before you change a hook.

**The advisor and the review ladder**

- `agents/advisor.md` — the subagent: `model: fable`, and exactly three tools, `Read`, `Grep`, `Glob`.
- `review-tier.mjs` — reads a diff and prints the review effort tier: `none`, `medium`, `high`, `xhigh`.

**The hooks**

- `advisor-inject.mjs` — states the loop on a prompt carrying a code or design signal, and resets the gate.
- `advisor-gate.mjs` — blocks edits to source files until the advisor has been consulted.
- `advisor-mark.mjs` — clears the gate once the advisor actually is consulted.
- `update-check.mjs` — one line at session start when a newer tag exists upstream.
- `commit-language.mjs` — blocks a `git commit` or `gh pr create` whose message reads as Turkish.
- `git-discipline.mjs` — the branch, the conventional subject, and the `/clean` → review → `/pr-update` order.
- `comment-ratio.mjs` — nudges when an edit lands more comment lines than code.
- `plan-capture.mjs` — copies an approved plan-mode plan into `plans/`, numbered and indexed as an `improve` plan, when that directory exists.

**The rules**

- `advisor-executor.md` — the behavioral spec Claude reads every session.
- `coding-discipline.md` — minimum code, surgical edits, comments as a last resort, plain repo prose.

**The skills**

- `shadcn` — shadcn/ui's own skill, model-invoked, carrying this repo's edits to its rules.
- `grilling` and `/grill-me` — a planning interview that settles open decisions before the consult.
- `/consig-upgrade` — pulls the clone, reinstalls, runs the doctor, reports what moved.
- `/yagni` — a deletion pass: make the code smaller without making it do less.
- `/wizard` — writes a bash script for the steps only a human can take.
- `systematic-debugging` — four phases, and no fix proposed before the root cause is found.

The advisor has no Bash and no network. Anything a verdict needs beyond Read, Grep and Glob it hands back as `RESEARCH NEEDED: <question>` under a verdict opening with PROVISIONAL; the main loop does the work and re-consults with the answer and its source appended.

## The built-in advisor tool

Claude Code ships its own advisor. `/advisor <model>`, the `advisorModel` setting, or `claude --advisor <model>` picks a second model that Claude consults server-side when it decides to. It shares the name with this loop's advisor and little else.

- Trigger: Claude chooses when to call the built-in one. Here `advisor-gate.mjs` blocks source edits until a consult happened, and a built-in advisor call does not clear it — `advisor-mark.mjs` only marks an `Agent` or `SendMessage` call aimed at the `advisor` subagent.
- Input: the built-in one reads the whole transcript, uncached, on every call. This loop's advisor gets the five-part consult and reads the files it names.
- Output: free-form guidance. No SHIP / FIX-FIRST / RETHINK verdict, no labelled findings, no `review-tier.mjs` ladder, no `RESEARCH NEEDED` handback.
- Availability: Anthropic API only, experimental. The subagent runs on any deployment.

Running both pays for every decision twice, so the installer sets `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`. `/advisor` becomes unavailable and a configured `advisorModel` is ignored. To use the built-in tool instead, set the key to `""` in `settings.json`; the installer fills a recommended key only when it is absent, so your value survives an upgrade. `node doctor.mjs` warns about an `advisorModel` only when the key is not in effect, which is the case that bills you twice.

## Keeping plan-mode plans

Plan mode already writes its plan to a file, at `~/.claude/plans/<slug>.md`. That location is machine-local, is not partitioned by project, and the slug names no repo, so the plan is invisible to git, to a reviewer, and to you on another machine.

`plan-capture.mjs` copies it beside the code it plans, as an `improve` plan. Opt in per repo:

```sh
mkdir -p plans
```

From then on every approved plan lands there as `NNN-<slug>.md`, numbered after the highest plan already in the directory, with its row appended to the status table in `plans/README.md` — created from `improve`'s template when absent. Priority, Effort and Depends on come from the plan's own Status block; the status starts at `TODO`. A repo whose `plans/` already means something else uses `advisor-plans/` instead, which is the same escape hatch `improve` takes. Without either directory the hook does nothing — it is the only hook here that writes into your working tree, so the directory is the consent.

One numbering, one index, so `/improve` continues from where plan mode stopped: `reconcile` refreshes a captured plan like any other, `execute` hands it off. A re-plan in the same session reuses the slug but takes the next number, so it never overwrites the plan it replaces.

The directory also shapes the plan. `rules/advisor-executor.md` says that when it exists, the plan is written in `/improve`'s sections — title, drift check, Status, Why this matters, Current state, Scope, Steps that name exact files and end in a `**Verify**` command, Test plan, Done criteria as checkboxes, STOP conditions, Maintenance notes. Two things `/improve` carries only for a cold executor are dropped: no inlined code excerpts and no commands table. Plan mode has already read the files, and you read the plan on screen before you approve it, so nothing is re-audited on the way in.

`ExitPlanMode` carries no plan text; it signals that the file is ready. The hook reads the path from the last `plan_mode` attachment in the session transcript. When there is no attachment, or the file it names is gone, the hook exits silently rather than blocking the turn. A rejected plan leaves nothing behind: `PostToolUse` fires only after a tool completes, and rejecting a plan is a permission denial.

## Requirements

- **Claude Code** (ships Node). That's it.
- **macOS, Linux, or Windows.** Every hook is Node and every installed hook command is `node "<absolute path>"`, so nothing here needs bash — Claude Code on Windows runs PowerShell or CMD just as often. The test suite runs on all three in CI.
- *Optional, only for `--with-workflow`:* the **ralph-loop plugin** — `/plugin install ralph-loop@claude-plugins-official`.

The advisor pins `model: fable`. If your account can't reach Fable, Claude Code falls back to the inherited model rather than failing the request — the loop still works, just with the same model on both sides of it, which costs you the independent perspective. Change the `model:` line in `~/.claude/agents/advisor.md` to something your plan reaches and the fallback stops being silent.

## Install

```bash
git clone https://github.com/anilsoylu/consigliere.git
cd consigliere
node install.mjs
```

Or hand the repo to Claude Code and say: *"run `node install.mjs` in this repo."*

The installer is idempotent — re-running it changes nothing. It backs up `settings.json` and any agent, rule, hook, or skill file it would overwrite (`.consigliere.bak`), and merges its hooks without touching your existing ones. Restart Claude Code (plain `claude`) afterward so the agent, rules, and hooks load.

### What it writes into settings.json

Besides its hook entries, the installer fills in the settings this loop is tuned against — **only where you have no value of your own**. A key you already set is yours, even when it disagrees; the uninstaller doesn't revert any of them, because a filled gap is indistinguishable from a choice later.

```json
{
  "env": {
    "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING": "1",
    "MAX_THINKING_TOKENS": "31999",
    "CLAUDE_CODE_DISABLE_1M_CONTEXT": "1",
    "CLAUDE_CODE_NO_FLICKER": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "CLAUDE_CODE_DISABLE_ADVISOR_TOOL": "1"
  },
  "includeCoAuthoredBy": false,
  "alwaysThinkingEnabled": true
}
```

The two that matter most to the loop: adaptive thinking is off and the thinking budget is fixed rather than inferred, so a consult that looks routine does not get a shallower pass. Effort is not pinned. The advisor carries `effort: medium` in its own frontmatter, and the main model's effort follows `/effort`, which a `CLAUDE_CODE_EFFORT_LEVEL` env value would override for every model alike. Earlier versions also set `ANTHROPIC_CUSTOM_MODEL_OPTION` to put Fable 5.1 in the `/model` picker; Claude Code 2.1.260 lists it on its own, so the key is gone from the defaults. One you already have does no harm, and `model: fable` in the subagent definition never depended on it. The 1M context window is off on purpose: the whole design keeps the advisor's input small and deliberate, and a bigger window works against that. Every value takes effect on the next `claude` start, and `settings.json` is backed up before the installer touches it.

Run `node doctor.mjs` and it reports which of these have no value set. Delete any you disagree with and re-running the installer puts them back, because an absent key reads as a gap. Set it to your own value if you want it to stick.

### Optional: context-mode

The heaviest thing in a long session is raw tool output sitting in the context window forever. [context-mode](https://github.com/mksglu/context-mode) is a third-party MCP server that runs commands in a sandbox, indexes the output, and hands back only what you searched for.

Consigliere does not install it for you. `/plugin install` shows a trust prompt before running someone else's code, and writing the plugin entries from a script would answer that prompt on your behalf — for every person who installs this package. So the installer prints the procedure and the doctor reports whether you ran it:

```
/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode
```

Then restart Claude Code (or `/reload-plugins`) and verify with `/context-mode:ctx-doctor` — it checks runtimes, hooks, FTS5, and plugin registration. Routing is automatic after that: a `SessionStart` hook injects the instructions at runtime and writes nothing into your project.

Once the plugin is enabled, re-running the installer also quiets its chattiest reminders through two env keys it fills only where absent: `CONTEXT_MODE_BASH_NUDGE_MIN_COMMAND_BYTES=200` silences the per-command routing nudge on short Bash calls, and `CONTEXT_MODE_EXTERNAL_MCP_NUDGE_EVERY=50` thins the external-MCP reminder from every 10th call to every 50th. Neither touches the curl/wget flood interception that is the plugin's actual saving, and a value you already set is never overwritten.

Its savings bar is a separate, manual step, because a Claude Code plugin manifest can't declare a status line. The installer prints this when context-mode is enabled and your `statusLine` is empty, and never writes it — there is one slot, it's a whole terminal row, and an empty one means you want no bar, not that you have no opinion:

```json
{ "statusLine": { "type": "command", "command": "context-mode statusline" } }
```

One caveat the vendor's docs don't mention: that command has to resolve on your `PATH`, and on the machine this was written on it did not (`command -v context-mode` → not found), even with the plugin installed and working. If your bar comes up empty, that's why — the CLI is bundled inside the plugin cache at `~/.claude/plugins/cache/context-mode/context-mode/<version>/bin/statusline.mjs`, which runs fine when invoked directly, so point `node` at it and re-point it after an upgrade.

It's licensed ELv2, not MIT, and its performance numbers are its authors'. What's observable from the outside: it intercepts tool output before it lands in the window, which is exactly the pressure this loop is under when the advisor and the executor both need room to think.

To verify an install without changing anything:

```bash
node doctor.mjs
```

The doctor byte-compares the installed agent and hooks against this repo's copies — an existing but edited hook is not the hook you think is running — and checks the default rules, the `settings.json` hook entries, the recommended settings, the yagni and shadcn skills, and whether context-mode is enabled. A file you customized is reported, not flagged. It exits non-zero only for hard failures such as an unusable `settings.json` or missing repo assets; incomplete installs are warnings you fix by re-running the installer.

A missing `agents/advisor.md` is called out specifically, because the gate blocks source edits and names that subagent as the way through: installed without it, you have a lock with no key.

For machine-readable output:

```bash
node doctor.mjs --json
```

### Optional: the workflow rule

```bash
node install.mjs --with-workflow
```

This adds a third rule, `workflow.md`, plus the `ralph-protocol` skill it defers to: a bounded execution loop on top of the advisor loop. Plans live in `tasks/todo.md` with a fixed shape (goal, acceptance criteria, verification commands, attempts, review), a verifier hierarchy decides what counts as proof, and long jobs run through `/ralph-loop` capped at 8 iterations with an explicit `RESULT: VERIFIED_COMPLETE` / `RESULT: BLOCKED` stop line. That proof is never read through a pipe: one verifier per call, output redirected to a file, because `tail` or `grep` on the end of a run hands back the filter's exit status instead of the verifier's — a red run reads as green.

The rule stays short on purpose — the entry conditions, iteration discipline, verifier hierarchy, and stop conditions live in the skill, which Claude loads when Ralph actually comes up instead of on every session.

The same flag ships the three skills the rule names for the git handoff: `/clean` polishes your own diff by hand, `/pr-update` opens or refreshes the PR, `/pr-ready` unblocks one that's already open. What the rule adds is their order — clean, *then* the review, *then* the PR — because cleaning rewrites the diff, so a review that ran before it judged code that no longer exists. It also tells you never to run the `cpr` shortcut, which fuses the polish and the PR into one pass and leaves no gap for the review; that skill is not shipped here. Upstream is [brooklyn-skills](https://github.com/OutThisLife/brooklyn-skills) (MIT) — the copies here drop the handoffs to sibling skills this package doesn't install.

It also ships the optimization pair the rule wires into that order. `/optimize` is an exact-parity speed rewrite of a named routine: characterization test first, baseline timing, then shorter and faster with bitwise-identical behavior, and before/after numbers are required. It fires unprompted when clean's diff read surfaces a compute-heavy routine — data loops, math kernels, parsers, media processing. Detection rides the read clean already does, so it costs no extra pass. Unattended runs are bitwise-only: if parity can't hold, the rewrite is reverted rather than shipped with a tolerance nobody approved. `/perf` covers the other direction, "why is this slow" with no known target: baseline, profile, fix the real hot path, re-measure. Each routes the other's case to it by name, so they install together. perf's upstream is brooklyn-skills (MIT); optimize is original here.

Upgrading a `--with-workflow` install from a version before the optimize pair: rerun `node install.mjs --with-workflow`, or the doctor's workflow-assets check will report the two skills missing.

It's opt-in because it's opinionated and because the Ralph half needs a plugin Consigliere doesn't ship — `/plugin install ralph-loop@claude-plugins-official`. Install it without the plugin and you get the planning and verification discipline, just not the `/ralph-loop` and `/cancel-ralph` commands; the installer warns and continues.

### Optional: the merge-readiness review graph

```bash
node install.mjs --with-merge-readiness
```

The advisor loop gives you one reviewer. This gives you a graph. Run `/merge-readiness` on a branch and four lenses — security, data-migration, api-contract, perf — read the diff in parallel, then every finding they produce is handed to a judge that didn't write it and told to refute it.

Two rules hold it up. **The judge is never weaker than the author:** tier 1 is the same model at higher effort, tier 2 escalates the model instead and steps effort back down, so you never pay for both axes at once. **The judge doesn't see the author's reasoning:** it gets the claim and the hunk and nothing else, because a judge that reads the justification anchors to it and approves.

The verdict on whether the tree is sound comes from your own verifier's exit code, not from a model's opinion — if the baseline is already red, the run stops instead of reviewing a broken tree. Nothing in the graph writes code; every judging node is schema-bound to return a verdict, and fixes happen afterwards in the main loop where you can see them.

It costs up to 13 agents a run, so `review-tier.mjs` only routes `xhigh` here; routine diffs stay on the single advisor consult. Reach for it by hand on a `high` diff when it's big enough that one reviewer will miss something and you can say why.

## Auto mode

Consigliere ships no `autoMode` block, on purpose.

Claude Code's auto-mode classifier reads the same instruction files Claude does, so the rules this package installs are already policy — it will block a call and cite one of them back to you as your own standing rule. Restating that doctrine under `autoMode` would be a second, drift-prone encoding of one policy, and `claude auto-mode critique` flags redundant rules on sight. Exact, mechanical rules belong in a hook anyway; the classifier is for judgment calls a pattern can't express.

What the rules genuinely cannot express is your infrastructure, and that is yours to write. It goes in `~/.claude/settings.json` — the classifier does not read `autoMode` from project settings:

- `environment` is where to start and usually the only field you need. It is also the only one that clears the `hard_deny` exfiltration rule, so a trusted bucket or domain belongs here and nowhere else.
- Keep the literal `"$defaults"` in every list. Dropping it takes ownership of 60-odd built-in denies that you then maintain forever.
- Reach for `allow` last. An entry there is a *mandatory* exception that overrides matching soft denies, so a vague one disables protections you never went looking for.

`claude auto-mode defaults` prints the built-in rules, `config` prints what you actually get, and `critique` reads your own entries back and names the ambiguous ones.

## Updating

```bash
cd consigliere && git pull && node install.mjs
```

Or type `/consig-upgrade`, which runs exactly that in the clone the state file records, then the doctor, and reports what changed.

Re-running the installer is the whole update — no flags needed the second time. The optional assets you opted into are recorded in the state file and reinstalled on every run; to drop one, run `node uninstall.mjs`; leaving the flag off does nothing. You don't have to notice on your own: releases are plain `git tag v<major>.<minor>.<patch>`, `install.mjs` records the version it wrote into `~/.claude/.consigliere-state.json`, and `update-check.mjs` compares the two.

The check never blocks and never runs in the foreground. At session start the hook reads a cached answer and exits; at most once a day it hands the network work to a detached child that runs `git ls-remote --tags origin` in the clone you installed from and writes the result for the *next* session. Offline costs nothing, a fork checks its own origin rather than this one, and the clock advances whether or not the lookup succeeded — a failing check waits out the day like a successful one.

That `git ls-remote` is the only thing this package ever sends anywhere: one tag listing, to the remote of a repo you already cloned. It stands down entirely under `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` or `CONSIGLIERE_NO_UPDATE_CHECK=1`. If you set either — and this repo's own recommended env sets the first — use `node doctor.mjs` instead, which makes the same comparison on demand and blocks while it does, because blocking in a CLI you ran on purpose is fine.

## Uninstall

```bash
node uninstall.mjs
```

Strips only its own hook entries from `settings.json` — an unrelated hook sharing the same block survives — and leaves your backups in place. It does not revert the recommended env keys or settings, and does not touch plugins: once a value is in your settings.json there is no way to tell a gap the installer filled from one you kept on purpose. The pre-uninstall backup is right there if you want the old file. Any file it placed is deleted only while it's still byte-identical to this repo's copy: agent, hooks, rules, and skills alike. Edit one and the uninstaller keeps it and tells you, rather than throwing away your version; the hook stays on disk but is no longer wired up.

## Upgrading from the Codex Sol advisor

Before this version the advisor was Codex GPT-5.6 Sol, driven over the Codex plugin by a bash watchdog. That version is tagged [`v1-sol`](https://github.com/anilsoylu/consigliere/releases/tag/v1-sol) and still installs:

```bash
git checkout v1-sol && node install.mjs
```

The native subagent replaced it because it needs none of what Sol needed — no ChatGPT Plus, no plugin, no `codex login`, and no watchdog to survive 40-minute web-search hangs.

Upgrading in place leaves one orphan: `~/.claude/hooks/advisor-watchdog.sh` is no longer in the manifest, so neither the installer nor the uninstaller touches it. Nothing invokes it and it costs nothing to keep; `rm ~/.claude/hooks/advisor-watchdog.sh` when you want it gone. The installer says so if it finds one.

## Limits

- **Fable availability:** the advisor pins `model: fable`. On a plan that can't reach it, Claude Code silently falls back to the inherited model — the loop keeps working, but planner and builder become the same model and you lose the independent read. See [Requirements](#requirements). `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` overrides `model:` in every agent definition, including this one. Unless `CLAUDE_CODE_SUBAGENT_MODEL` names a planner model, it collapses the loop the same way, so leave it unset; `node doctor.mjs` warns when it is set.
- Consigliere assumes Opus as the executor. If you want a different main model, pick it with `/model`; nothing here needs changing.
- **Two skills still need a POSIX shell:** `wizard` generates bash scripts around `template.sh`, and `systematic-debugging` bisects test pollution with `find-polluter.sh`. Nothing in the hook chain does — on Windows, run those two under Git Bash or WSL.
- **`--with-merge-readiness`:** the skill drives Claude Code's Workflow tool, so nothing fires automatically — you run `/merge-readiness` and Claude asks before spawning the graph. Its tier-2 judge pins Fable for the same reason the advisor does, with the same fallback.

## License

MIT. See [LICENSE](LICENSE).

Bundled skills and what changed in them:

| Skill | Upstream | What changed here |
| --- | --- | --- |
| `shadcn` | [shadcn-ui/ui](https://github.com/shadcn-ui/ui), MIT | the files under its `rules/` are modified |
| `clean`, `pr-update`, `pr-ready`, `perf` | [OutThisLife/brooklyn-skills](https://github.com/OutThisLife/brooklyn-skills), MIT | dropped references to sibling skills this package doesn't ship; `perf` gained the routing line to `/optimize` |
| `grilling`, `grill-me` | [mattpocock/skills](https://github.com/mattpocock/skills), MIT | a plain-markdown question format, and the advisor handoff |
| `wizard` | [mattpocock/skills](https://github.com/mattpocock/skills), MIT | three places: one paragraph on what may be handed to a human at all, a step 1 that reads key names instead of live secrets, and a `template.sh` that single-quotes values into `.env` and unquotes them back out |
| `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers), MIT | four places: a Phase 1 that demands a failing-then-passing command before any Phase 2, grep-tagged debug instrumentation, a ranked 3-5 hypothesis Phase 3, and a Phase 4 that re-consults the advisor once the same error survives two fixes; plus two `superpowers:*` references swapped for the equivalent `coding-discipline.md` rules |
| `optimize` | original to this repo | — |

context-mode is neither bundled nor installed by this package. It's ELv2, and you install it yourself through `/plugin`.
