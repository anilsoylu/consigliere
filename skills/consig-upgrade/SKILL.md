---
name: consig-upgrade
description: "Pull the consigliere clone, reinstall it, and run the doctor. Use when update-check reports a newer version, or to verify the installed copy still matches the repo."
disable-model-invocation: true
---

# consig-upgrade

Runs the upgrade the README documents, in the clone the installer recorded, and reports
what changed.

`disable-model-invocation` is load-bearing: this writes into the user's live `~/.claude`,
so it runs when they type `/consig-upgrade` and never because a session decided it was
time.

## Steps

1. Read `~/.claude/.consigliere-state.json`. Its `repo` field is the clone `install.mjs`
   was run from — the upgrade goes there, not to a path you guess. No file, or no `repo`
   in it: stop and say consigliere is not installed by this installer.
2. `git -C <repo> pull --ff-only`. A dirty tree or a diverged branch fails here; report
   the git output and stop rather than resetting anything.
3. `node <repo>/install.mjs`. No flags — the installer reads back the optional assets the
   user opted into. Passing them again is harmless but never necessary.
4. `node <repo>/doctor.mjs`.

## Report

A checklist, `[x]` for success and `[ ]` for failure, with the real version numbers:

```
## consigliere upgrade
- [x] Pulled v1.2.0 -> v1.2.1
- [x] Reinstalled (flags: --with-workflow)
- [x] Doctor: 16 pass, 1 warn, 0 fail
```

Then one line: restart Claude Code so the new hooks and rules load.

Relay every doctor warning verbatim. A warning about a locally customized file is not an
error — the installer backs up what it replaces, so name the `.consigliere.bak` beside it.
