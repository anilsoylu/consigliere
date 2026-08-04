# Consigliere

A second brain for Claude Code: **Codex GPT-5.6 Sol plans, Claude Opus builds.**

Sol thinks through *how* to do the work — architecture, edge cases, second opinions — but never touches your files. Opus, the main Claude Code loop, writes the code. A watchdog keeps Codex from hanging, and a gate stops Claude from writing source until the advisor has weighed in.

It runs on your existing **ChatGPT Plus / Codex login**. No OpenAI API key, no proxy, no second subscription.

## Why

Letting one model plan and build in the same breath is how you get code that solves the wrong problem confidently. Splitting the roles helps: a planner that only reasons, a builder that only executes. Codex Sol is strong at planning and critique; Opus is strong at disciplined execution. Consigliere wires them together and handles the parts that break in practice — Codex hanging on a web search for 40 minutes, a review that quietly drops half its findings, an advisor that "promises" not to edit but could.

## How it works

```
your prompt
   → Sol plans it (read-only, watchdog-wrapped)      ← the brain
   → you approve
   → Opus implements it                              ← the hands
   → Claude runs a risk-tiered /review on the diff (medium / high --fix / xhigh)
   → done

```

Seven pieces, all installed under `~/.claude`:

- **`advisor-watchdog.sh`** — runs Sol as a background Codex job, polls its log, and cancels it if it stalls for 5 minutes. No more one-hour hangs; a stuck advisor just falls back to Opus alone. Takes the prompt inline or via `--file` (for diffs and failing output), and appends the advisor doctrine — verdict-not-survey, no manufactured objections, ~300-word cap, no web search — to every consult so the caller never retypes it.
- **`review-tier.sh`** — a deterministic classifier that reads the working-tree diff and prints the review effort tier: `medium` for routine CRUD/UI/config diffs; `high` for business logic, sizeable refactors, and the broad risky vocabulary — auth, session, checkout, middleware — (run with `--fix`); `xhigh` reserved for unambiguous surfaces: payment providers, crypto primitives, migration and schema files, plus a narrow scan of added lines for signals like `STRIPE_SECRET_KEY` or `jwt.sign`. Repeated false alarms at the top tier would teach you to ignore it, so the expensive floor is deliberately precise. Claude's built-in `/review` runs at that tier before any deliverable is reported done — the review runs on your Claude plan, keeping the Codex quota for planning. A `.review-tiers` file in a repo root adds per-project floors; the model may escalate a tier with a stated reason, never downgrade one.
- **`advisor-inject.mjs`** — a `UserPromptSubmit` hook that resets the gate on each new task and states the loop, but only when the prompt actually carries a code/design signal (a source filename, a design skill, an intent verb, or an outright "consult Sol"). Everything else gets silence. A directive that fires on "how much does this cost" is one the model learns to skip, so the selectivity is what keeps it worth reading.
- **`advisor-gate.mjs`** — a `PreToolUse` hook that blocks edits to real source-code files until the advisor has been consulted. Notes, configs, `~/.claude`, `~/.codex`, `/tmp`, and `~/Desktop` are exempt, so it never gets in the way of scratch work.
- **`advisor-mark.mjs`** — clears the gate once the advisor is actually called.
- **`advisor-executor.md`** — the behavioral spec Claude reads every session.
- **`coding-discipline.md`** — a short rule that keeps the *executor* honest: state assumptions before coding, write the minimum that solves the problem, touch only what the request implies. Independent of the advisor loop; useful on its own.

Three design choices that matter:

- **Read-only is a mechanism, not a promise.** The companion runs Codex without `--write`, so the advisor's sandbox is read-only. Sol *cannot* edit your files, even if a prompt told it to. It still reads them — `git diff`, `git blame`, `ripgrep` — to ground its judgment.
- **Consults carry a five-part contract.** Sol shares none of the conversation's context, so every consult states the objective, the exact files, the evidence (the actual diff or failing output, never a paraphrase), the constraints, and the options considered. A consult you can't finish writing means the decision isn't formed yet.
- **The final review is mandatory, tiered, and unfiltered.** Before Claude reports a deliverable done, `review-tier.sh` picks the effort tier from the diff and Claude's built-in review runs at it, asked to report everything it finds — no severity filtering; you prioritize. Sol reads a diff only on demand ("consult Sol"): a deliberate cross-vendor second opinion that opens with a **SHIP / FIX-FIRST / RETHINK** verdict and labels every finding `[ADOPT]` / `[DISCUSS]` / `[STYLE]` / `[OVER-ENGINEERED]`, all relayed verbatim.

Sol has no web access (that was the thing that kept hanging). When it needs a current fact it writes `RESEARCH NEEDED: <question>` instead of searching; Opus looks it up with Claude's own web tools and hands the answer back.

## Requirements

- **Claude Code** (ships Node).
- The **Codex plugin** — `/plugin install codex@openai-codex` inside Claude Code.
- A **ChatGPT Plus / Codex login** — `codex login`. Not an API key.
- *Optional, only for `--with-workflow`:* the **ralph-loop plugin** — `/plugin install ralph-loop@claude-plugins-official`.

## Install

```bash
git clone https://github.com/anilsoylu/consigliere.git
cd consigliere
node install.mjs
```

Or hand the repo to Claude Code and say: *"run `node install.mjs` in this repo."*

The installer is idempotent — re-running it changes nothing. It backs up `settings.json`, `config.toml`, and any rule, hook, or skill file it would overwrite (`.consigliere.bak`), merges its hooks without touching your existing ones, and offers to disable Codex web search. Restart Claude Code (plain `claude`) afterward so the rules and hooks load.

To verify an install without changing anything:

```bash
node doctor.mjs
```

The doctor byte-compares the installed hooks against this repo's copies — an existing but edited hook is not the hook you think is running — and checks the default rules, `settings.json` hook entries, the Codex companion, Codex web-search setting, and watchdog executability. A rule you customized is reported, not flagged. It exits non-zero only for hard failures such as an unusable `settings.json` or missing repo assets; incomplete installs are warnings you fix by re-running the installer.

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

It's opt-in because it's opinionated and because the Ralph half needs a plugin Consigliere doesn't ship — `/plugin install ralph-loop@claude-plugins-official`. Install it without the plugin and you get the planning and verification discipline, just not the `/ralph-loop` and `/cancel-ralph` commands; the installer warns and continues.

### Optional: the merge-readiness review graph

```bash
node install.mjs --with-merge-readiness
```

The advisor loop gives you one reviewer. This gives you a graph. Run `/merge-readiness` on a branch and four lenses — security, data-migration, api-contract, perf — read the diff in parallel, then every finding they produce is handed to a judge that didn't write it and told to refute it.

Two rules hold it up. **The judge is never weaker than the author:** tier 1 is the same model at higher effort, tier 2 escalates the model instead and steps effort back down, so you never pay for both axes at once. **The judge doesn't see the author's reasoning:** it gets the claim and the hunk and nothing else, because a judge that reads the justification anchors to it and approves.

The verdict on whether the tree is sound comes from your own verifier's exit code, not from a model's opinion — if the baseline is already red, the run stops instead of reviewing a broken tree. Nothing in the graph writes code; every judging node is schema-bound to return a verdict, and fixes happen afterwards in the main loop where you can see them.

It's opt-in because it costs up to 13 agents a run, and because it's the wrong tool for a routine diff. This sits *above* `review-tier.sh` and the native tiered `/review`, not instead of them — reach for it when the tier comes back `high` or `xhigh` and the diff is big enough that one reviewer will miss something.

## Uninstall

```bash
node uninstall.mjs
```

Removes the hooks, strips only its own entries from `settings.json`, and leaves your backups in place. A rule is deleted only while it's still byte-identical to this repo's copy — edit one and the uninstaller keeps it and tells you, rather than throwing away your version.

## Limits

- **Windows:** the watchdog is a bash script. Run Claude Code from Git Bash or WSL; pure PowerShell can't execute it.
- **Codex Sol on Plus:** whether `gpt-5.6-sol` shows up depends on your ChatGPT plan. If it doesn't, Codex falls back to whatever your account can reach, and the loop still works — just with a different advisor model.
- Consigliere assumes Opus as the executor. If you want a different main model, that's a `/model` choice, not a config change here.
- **`--with-merge-readiness`:** the skill drives Claude Code's Workflow tool, so nothing fires automatically — you run `/merge-readiness` and Claude asks before spawning the graph. Its tier-2 judge pins Fable 5; if your account can't reach that model, change the `model` on the escalation stage in `merge-readiness.js` to `opus` and you lose the second axis but keep the loop.

## License

MIT. See [LICENSE](LICENSE).
