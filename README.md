# Consigliere

A second brain for Claude Code: **Fable 5 plans, Claude Opus builds.**

The advisor thinks through *how* to do the work — architecture, edge cases, second opinions — but never touches your files. Opus, the main Claude Code loop, writes the code. A gate stops Claude from writing source until the advisor has weighed in.

It runs entirely inside Claude Code. No second vendor, no API key, no plugin, no login.

## Why

Letting one model plan and build in the same breath is how you get code that solves the wrong problem confidently. Splitting the roles helps: a planner that only reasons, a builder that only executes. Fable is strong at planning and critique; Opus is strong at disciplined execution. Consigliere wires them together and handles the parts that break in practice — a review that quietly drops half its findings, an advisor that "promises" not to edit but could, a gate that fires on scratch files and teaches you to ignore it.

## How it works

```
your prompt
   → the advisor plans it (Read/Grep/Glob only)      ← the brain
   → you approve
   → Opus implements it                              ← the hands
   → a risk-tiered review of the diff (medium+high: the advisor / xhigh: merge-readiness)
   → done

```

Nine pieces, all installed under `~/.claude`:

- **`agents/advisor.md`** — the advisor itself, a Claude Code subagent pinned to `model: fable` with `effort: high` and exactly three tools: `Read`, `Grep`, `Glob`. The doctrine lives here rather than in every consult — verdict-not-survey, no manufactured objections, prefer deleting, ~300-word cap — so the caller never retypes it. Called as `Agent({ subagent_type: "advisor", run_in_background: false })`.
- **`review-tier.sh`** — a deterministic classifier that reads the working-tree diff — or any base you pass as `review-tier.sh . <ref>`, which is what committed branch work needs — and prints the review effort tier: `medium` for routine CRUD/UI/config diffs; `high` for business logic, sizeable refactors, and the broad risky vocabulary — auth, session, checkout, middleware; `xhigh` reserved for unambiguous surfaces: payment providers, crypto primitives, migration and schema files, plus a narrow scan of added lines for signals like `STRIPE_SECRET_KEY` or `jwt.sign`. Repeated false alarms at the top tier would teach you to ignore it, so the expensive floor is deliberately precise. The review runs at that tier before any deliverable is reported done. A `.review-tiers` file in a repo root adds per-project floors; the model may escalate a tier with a stated reason, never downgrade one.
- **`advisor-inject.mjs`** — a `UserPromptSubmit` hook that resets the gate on each new task and states the loop, but only when the prompt actually carries a code/design signal (a source filename, a design skill, an intent verb, or an outright "consult the advisor"). Everything else gets silence. A directive that fires on "how much does this cost" is one the model learns to skip, so the selectivity is what keeps it worth reading.
- **`advisor-gate.mjs`** — a `PreToolUse` hook that blocks edits to real source-code files until the advisor has been consulted. Notes, configs, `~/.claude`, `/tmp`, and `~/Desktop` are exempt, so it never gets in the way of scratch work.
- **`advisor-mark.mjs`** — clears the gate once the advisor subagent is actually called.
- **`advisor-executor.md`** — the behavioral spec Claude reads every session.
- **`coding-discipline.md`** — a short rule that keeps the *executor* honest: state assumptions before coding, write the minimum that solves the problem, touch only what the request implies, and let a comment earn its line by saying *why* rather than restating the code. Independent of the advisor loop; useful on its own.
- **the `shadcn` skill** — shadcn/ui's own skill, carrying this repo's edits to its rules: when to reach for Base UI versus Radix, how composition and forms are supposed to look, icons, styling, chat surfaces. Model-invoked rather than a slash command, so it costs nothing until Claude is actually writing shadcn code, and then it stops Claude from inventing component APIs. Upstream is [shadcn/ui](https://github.com/shadcn-ui/ui) (MIT) — the rules are modified, everything else is theirs.
- **the `grilling` skill** — a relentless planning interview, fired automatically when a fresh prompt leaves two or more material decisions open, or by hand as `/grill-me` (upstream's user-only wrapper, shipped with it). It maps the plan as a design tree and asks in rounds: every question whose prerequisites are settled goes in the current round, numbered, each with a recommended answer; the answers push the frontier outward and unblock the next round. Facts are never your job — anything the model can look up itself, it looks up; only the decisions come to you. The session ends when the frontier is empty, and the settled tree becomes the advisor consult's objective and options-considered — which is the point: a consult built from settled decisions instead of guesses. It never fires unattended; ralph, cron, and background runs state their assumptions and proceed. Upstream is [mattpocock/skills](https://github.com/mattpocock/skills) (MIT), edited here to a plain-markdown question format plus the advisor handoff.
- **the `yagni` skill** — the deliberate enforcement pass for that rule, run as `/yagni`. It has one job: make the code smaller without making it do less. Interfaces with one implementation, wrappers that only forward, flags nobody sets, guards for states the types already rule out, the same fact maintained in two places — including a comment that only restates the line under it, which drifts exactly like duplicated code except nothing ever fails because of it. Every finding has to answer one question — does removing this leave fewer concepts, branches, config points, layers, or maintained facts, with no behavior lost — and anything that fails it is left to the review pass. That boundary is the whole design: a simplicity pass that also has opinions about naming and architecture is a second code review with softer criteria, and you stop reading it. It ships by default because it costs nothing until you invoke it.

Three design choices that matter:

- **Read-only is structural, not a promise.** The subagent's `tools:` line grants `Read`, `Grep`, `Glob` and nothing else — no `Edit`, no `Write`, no `Bash`. The advisor *cannot* change the repository even if a prompt told it to, or if it decides it should. It still reads the files you name, to ground its judgment.
- **Consults carry a five-part contract.** The advisor shares none of the conversation's context, so every consult states the objective, the exact files, the evidence (the actual diff or failing output, never a paraphrase), the constraints, and the options considered. A consult you can't finish writing means the decision isn't formed yet.
- **The final review is mandatory, tiered, and unfiltered.** Before Claude reports a deliverable done, `review-tier.sh` picks the effort tier from the diff. `medium` and `high` go to a fresh advisor consult carrying the diff; `xhigh` goes to `merge-readiness`. Either way the reviewer is asked to report everything it finds — no severity filtering; you prioritize. The advisor opens with a **SHIP / FIX-FIRST / RETHINK** verdict and labels every finding `[ADOPT]` / `[DISCUSS]` / `[STYLE]` / `[OVER-ENGINEERED]`, all relayed verbatim, and every `[ADOPT]` is fixed before the verifier runs again. Claude's own `/review` is not in this path: its frontmatter carries `disable-model-invocation`, so it only runs when *you* type it — no use to a loop working while you're asleep. Gating with the advisor is still independent review: the model that wrote the code isn't the one judging it, and each advisor spawn is stateless, so the instance reading the diff never saw the plan.

The advisor has no web access. When it needs a current fact it writes `RESEARCH NEEDED: <question>` instead of guessing; the main loop looks it up with Claude's own web tools and re-consults with the answer appended.

## Requirements

- **Claude Code** (ships Node). That's it.
- *Optional, only for `--with-workflow`:* the **ralph-loop plugin** — `/plugin install ralph-loop@claude-plugins-official`.

The advisor pins `model: fable`. If your account can't reach Fable 5, Claude Code falls back to the inherited model rather than failing the request — the loop still works, just with the same model on both sides of it, which costs you the independent perspective. Change the `model:` line in `~/.claude/agents/advisor.md` to something your plan reaches and the fallback stops being silent.

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
    "CLAUDE_CODE_EFFORT_LEVEL": "high",
    "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING": "1",
    "MAX_THINKING_TOKENS": "31999",
    "CLAUDE_CODE_DISABLE_1M_CONTEXT": "1",
    "CLAUDE_CODE_NO_FLICKER": "1",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "ANTHROPIC_CUSTOM_MODEL_OPTION": "claude-fable-5",
    "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": "Fable 5"
  },
  "includeCoAuthoredBy": false,
  "alwaysThinkingEnabled": true
}
```

The two that matter most to the loop: effort stays pinned high with adaptive thinking off, so the advisor's model doesn't quietly drop to a shallower pass on a consult that looks routine, and the thinking budget is fixed rather than inferred. `ANTHROPIC_CUSTOM_MODEL_OPTION` puts Fable 5 in the `/model` picker; it is not what makes the advisor work — `model: fable` in the subagent definition is a built-in alias and resolves without it. The 1M context window is off on purpose: a bigger window is a worse loop, not a better one, when the whole design is to keep the advisor's input small and deliberate. Every value takes effect on the next `claude` start, and `settings.json` is backed up before the installer touches it.

Run `node doctor.mjs` and it reports which of these have no value set. Delete any you disagree with and re-running the installer puts them back — that's a gap, not a preference; set the key to your own value if you want it to stick.

### Optional: context-mode

The heaviest thing in a long session is raw tool output sitting in the context window forever. [context-mode](https://github.com/mksglu/context-mode) is a third-party MCP server that runs commands in a sandbox, indexes the output, and hands back only what you searched for.

Consigliere does not install it for you. `/plugin install` shows a trust prompt before running someone else's code, and writing the plugin entries from a script would answer that prompt on your behalf — for every person who installs this package. So the installer prints the procedure and the doctor reports whether you ran it:

```
/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode
```

Then restart Claude Code (or `/reload-plugins`) and verify with `/context-mode:ctx-doctor` — it checks runtimes, hooks, FTS5, and plugin registration. Routing is automatic after that: a `SessionStart` hook injects the instructions at runtime and writes nothing into your project.

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

This adds a third rule, `workflow.md`, plus the `ralph-protocol` skill it defers to: a bounded execution loop on top of the advisor loop. Plans live in `tasks/todo.md` with a fixed shape (goal, acceptance criteria, verification commands, attempts, review), a verifier hierarchy decides what counts as proof, and long jobs run through `/ralph-loop` capped at 8 iterations with an explicit `RESULT: VERIFIED_COMPLETE` / `RESULT: BLOCKED` stop line.

The rule stays short on purpose — the entry conditions, iteration discipline, verifier hierarchy, and stop conditions live in the skill, which Claude loads when Ralph actually comes up instead of on every session.

The same flag ships the three skills the rule names for the git handoff: `/clean` polishes your own diff by hand, `/pr-update` opens or refreshes the PR, `/pr-ready` unblocks one that's already open. What the rule adds is their order — clean, *then* the review, *then* the PR — because cleaning rewrites the diff, so a review that ran before it judged code that no longer exists. It also tells you never to run the `cpr` shortcut, which fuses the polish and the PR into one pass and leaves no gap for the review; that skill is not shipped here. Upstream is [brooklyn-skills](https://github.com/OutThisLife/brooklyn-skills) (MIT) — the copies here drop the handoffs to sibling skills this package doesn't install.

It also ships the optimization pair the rule wires into that order. `/optimize` is an exact-parity speed rewrite of a named routine — characterization test first, baseline timing, then shorter and faster with bitwise-identical behavior, before/after numbers required. It fires unprompted when clean's diff read surfaces a compute-heavy routine (data loops, math kernels, parsers, media processing) — detection rides the read clean already does, so it costs no extra pass — and unattended runs are bitwise-only: parity that can't hold means the rewrite is reverted, not shipped with a tolerance nobody approved. `/perf` is its counterpart for the other direction — "why is this slow" with no known target: baseline, profile, fix the real hot path, re-measure. Each routes the other's case to it by name, so they install together. perf's upstream is brooklyn-skills (MIT); optimize is original here.

Upgrading a `--with-workflow` install from a version before the optimize pair: rerun `node install.mjs --with-workflow`, or the doctor's workflow-assets check will report the two skills missing.

It's opt-in because it's opinionated and because the Ralph half needs a plugin Consigliere doesn't ship — `/plugin install ralph-loop@claude-plugins-official`. Install it without the plugin and you get the planning and verification discipline, just not the `/ralph-loop` and `/cancel-ralph` commands; the installer warns and continues.

### Optional: the merge-readiness review graph

```bash
node install.mjs --with-merge-readiness
```

The advisor loop gives you one reviewer. This gives you a graph. Run `/merge-readiness` on a branch and four lenses — security, data-migration, api-contract, perf — read the diff in parallel, then every finding they produce is handed to a judge that didn't write it and told to refute it.

Two rules hold it up. **The judge is never weaker than the author:** tier 1 is the same model at higher effort, tier 2 escalates the model instead and steps effort back down, so you never pay for both axes at once. **The judge doesn't see the author's reasoning:** it gets the claim and the hunk and nothing else, because a judge that reads the justification anchors to it and approves.

The verdict on whether the tree is sound comes from your own verifier's exit code, not from a model's opinion — if the baseline is already red, the run stops instead of reviewing a broken tree. Nothing in the graph writes code; every judging node is schema-bound to return a verdict, and fixes happen afterwards in the main loop where you can see them.

It costs up to 13 agents a run, so `review-tier.sh` only routes `xhigh` here; routine diffs stay on the single advisor consult. Reach for it by hand on a `high` diff when it's big enough that one reviewer will miss something and you can say why.

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

- **Fable availability:** the advisor pins `model: fable`. On a plan that can't reach it, Claude Code silently falls back to the inherited model — the loop keeps working, but planner and builder become the same model and you lose the independent read. See [Requirements](#requirements).
- Consigliere assumes Opus as the executor. If you want a different main model, that's a `/model` choice, not a config change here.
- **`--with-merge-readiness`:** the skill drives Claude Code's Workflow tool, so nothing fires automatically — you run `/merge-readiness` and Claude asks before spawning the graph. Its tier-2 judge pins Fable 5 for the same reason the advisor does, with the same fallback.

## License

MIT. See [LICENSE](LICENSE).

`skills/shadcn` is shadcn/ui's skill, MIT, from [shadcn-ui/ui](https://github.com/shadcn-ui/ui); the files under its `rules/` are modified here. `skills/clean`, `skills/pr-update`, `skills/pr-ready` and `skills/perf` are MIT, from [OutThisLife/brooklyn-skills](https://github.com/OutThisLife/brooklyn-skills), edited here to drop references to sibling skills this package doesn't ship (perf also gained the routing line to `/optimize`). `skills/grilling` and `skills/grill-me` are MIT, from [mattpocock/skills](https://github.com/mattpocock/skills), edited here to a plain-markdown question format and the advisor handoff. `skills/optimize` is original to this repo. context-mode is neither bundled nor installed by this package — it's ELv2 and you install it yourself through `/plugin`.
