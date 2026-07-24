# Consigliere

A second brain for Claude Code: **Codex GPT-5.6 Sol plans, Claude Opus builds.**

Sol thinks through *how* to do the work — architecture, edge cases, review — but never touches your files. Opus, the main Claude Code loop, writes the code. A watchdog keeps Codex from hanging, and a gate stops Claude from writing source until the advisor has weighed in.

It runs on your existing **ChatGPT Plus / Codex login**. No OpenAI API key, no proxy, no second subscription.

## Why

Letting one model plan and build in the same breath is how you get code that solves the wrong problem confidently. Splitting the roles helps: a planner that only reasons, a builder that only executes. Codex Sol is strong at planning and critique; Opus is strong at disciplined execution. Consigliere wires them together and handles the parts that break in practice — Codex hanging on a web search for 40 minutes, a review that quietly drops half its findings, an advisor that "promises" not to edit but could.

## How it works

```
your prompt
   → Sol plans it (read-only, watchdog-wrapped)      ← the brain
   → you approve
   → Opus implements it                              ← the hands
   → Sol reviews the diff (categorized, zero-filter)
   → done
```

Six pieces, all installed under `~/.claude`:

- **`advisor-watchdog.sh`** — runs Sol as a background Codex job, polls its log, and cancels it if it stalls for 5 minutes. No more one-hour hangs; a stuck advisor just falls back to Opus alone.
- **`advisor-inject.mjs`** — a `UserPromptSubmit` hook that reminds the loop what to do and resets the gate on each new task.
- **`advisor-gate.mjs`** — a `PreToolUse` hook that blocks edits to real source-code files until the advisor has been consulted. Notes, configs, `~/.claude`, `~/.codex`, `/tmp`, and `~/Desktop` are exempt, so it never gets in the way of scratch work.
- **`advisor-mark.mjs`** — clears the gate once the advisor is actually called.
- **`advisor-executor.md`** — the behavioral spec Claude reads every session.
- **`coding-discipline.md`** — a short rule that keeps the *executor* honest: state assumptions before coding, write the minimum that solves the problem, touch only what the request implies. Independent of the advisor loop; useful on its own.

Two design choices that matter:

- **Read-only is a mechanism, not a promise.** The companion runs Codex without `--write`, so the advisor's sandbox is read-only. Sol *cannot* edit your files, even if a prompt told it to. It still reads them — `git diff`, `git blame`, `ripgrep` — to ground its judgment.
- **Reviews are categorized and unfiltered.** When Sol reviews a diff it labels every finding `[ADOPT]` / `[DISCUSS]` / `[STYLE]` / `[OVER-ENGINEERED]`, and all of them reach you verbatim. You decide what to apply.

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

The installer is idempotent — re-running it changes nothing. It backs up `settings.json`, `config.toml`, and any rule file it would overwrite (`.consigliere.bak`), merges its hooks without touching your existing ones, and offers to disable Codex web search. Restart Claude Code (plain `claude`) afterward so the rules and hooks load.

### Optional: the workflow rule

```bash
node install.mjs --with-workflow
```

This adds a third rule, `workflow.md`: a bounded execution loop on top of the advisor loop. Plans live in `tasks/todo.md` with a fixed shape (goal, acceptance criteria, verification commands, attempts, review), a verifier hierarchy decides what counts as proof, and long jobs run through `/ralph-loop` capped at 8 iterations with an explicit `RESULT: VERIFIED_COMPLETE` / `RESULT: BLOCKED` stop line.

It's opt-in because it's opinionated and because the Ralph half needs a plugin Consigliere doesn't ship — `/plugin install ralph-loop@claude-plugins-official`. Install it without the plugin and you get the planning and verification discipline, just not the `/ralph-loop` and `/cancel-ralph` commands; the installer warns and continues.

## Uninstall

```bash
node uninstall.mjs
```

Removes the hooks, strips only its own entries from `settings.json`, and leaves your backups in place. A rule is deleted only while it's still byte-identical to this repo's copy — edit one and the uninstaller keeps it and tells you, rather than throwing away your version.

## Limits

- **Windows:** the watchdog is a bash script. Run Claude Code from Git Bash or WSL; pure PowerShell can't execute it.
- **Codex Sol on Plus:** whether `gpt-5.6-sol` shows up depends on your ChatGPT plan. If it doesn't, Codex falls back to whatever your account can reach, and the loop still works — just with a different advisor model.
- Consigliere assumes Opus as the executor. If you want a different main model, that's a `/model` choice, not a config change here.

## License

MIT. See [LICENSE](LICENSE).
