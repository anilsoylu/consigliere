# Security

## What this package does to your machine

`node install.mjs` writes only inside your Claude Code config directory
(`$CLAUDE_CONFIG_DIR`, or `~/.claude`): an agent definition, hooks, rules, skills, a
state file, and hook entries merged into `settings.json`. It backs up any file it would
overwrite and never removes a hook entry it did not write. Nothing runs as root. At
runtime the hooks also write per-session marker files into the OS temp directory; those
are the only bytes that land anywhere else.

## Network

One command, ever: `git ls-remote --tags origin` in the clone you installed from, to
compare tags. `update-check.mjs` runs it at most once a day and stands down under
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` or `CONSIGLIERE_NO_UPDATE_CHECK=1`;
`node doctor.mjs` runs it on every invocation with no opt-out, which is the point of the
doctor for anyone who turned the hook off. No telemetry, no analytics, no other endpoint.

## Reporting

Open a GitHub issue at https://github.com/anilsoylu/consigliere/issues. If the report
would expose users before a fix exists, use GitHub's private vulnerability reporting on
the same repository instead.

Only the latest tag is supported; fixes land there rather than as backports.
