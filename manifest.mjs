// What Consigliere installs and where it looks for its dependencies.
// install.mjs, uninstall.mjs, and doctor.mjs all read this, so the three cannot drift.
import fs from 'node:fs';
import path from 'node:path';

// Releases are `git tag v<VERSION>`; update-check.mjs and doctor.mjs both compare against
// that tag list, so bumping this without tagging makes an installed copy look ahead of
// upstream. Only vN.N.N sorts — the old `v1-sol` tag is deliberately unsortable.
export const VERSION = '1.4.5';
export const STATE_FILE = '.consigliere-state.json';

export const HOOK_FILES = [
  // First, and with no HOOK_ENTRIES line of its own: a module the hooks import rather than
  // a hook, and copying it after them leaves an upgrade window where an import throws.
  'config-dir.mjs',
  'advisor-inject.mjs', 'advisor-mark.mjs', 'advisor-gate.mjs', 'commit-language.mjs',
  'update-check.mjs', 'review-tier.mjs', 'git-discipline.mjs', 'comment-ratio.mjs',
];
// Files an earlier version installed and this one does not. Dropping a name from
// HOOK_FILES alone leaves an orphan nothing removes and doctor no longer looks at, so
// install.mjs deletes these and uninstall.mjs sweeps them.
export const OBSOLETE_HOOK_FILES = ['review-tier.sh'];
export const DEFAULT_RULES = ['advisor-executor.md', 'coding-discipline.md'];
export const WORKFLOW_RULE = 'workflow.md';

// The advisor itself, as a Claude Code subagent definition. advisor-gate.mjs blocks
// source edits and names this subagent as the way through, so a gate installed without
// the agent is a lock with no key. It gets the same missing/modified treatment as a hook.
export const AGENT_FILES = ['advisor.md'];

// The merge-readiness skill and the Workflow script it invokes are one feature: the
// skill reads the script from beside it, so either one alone is a dangling reference.
export const MERGE_READINESS_SKILL = 'merge-readiness';
export const MERGE_READINESS_FILES = ['SKILL.md', 'merge-readiness.js'];

// The skills rules/workflow.md orders by name — polish the diff, open or refresh the PR,
// unblock a stuck one. They share ralph-protocol's --with-workflow gate, because the rule
// that names them is on that flag and a rule naming an absent skill is the same dangling
// reference as a gate with no agent. Upstream is brooklyn-skills; see the attribution in
// README.md. `cpr` is deliberately absent: the rule tells you never to run it.
export const HANDOFF_SKILLS = ['clean', 'pr-update', 'pr-ready'];
export const HANDOFF_FILES = ['SKILL.md'];

// mattpocock's grilling interview, shipped as its upstream pair: `grilling` carries the
// doctrine, `grill-me` is the user-only slash wrapper that runs it, so either alone is a
// dangling reference. Default, not flagged: advisor-executor.md (a default rule) and the
// advisor-inject.mjs banner both call for grilling by name. See README for attribution.
export const GRILLING_SKILLS = ['grilling', 'grill-me'];
export const GRILLING_FILES = ['SKILL.md'];

// The exact-parity speed pass and the profile-driven perf loop route to each other by
// name ("why is this slow" → perf; a named routine → optimize), so they ship as one
// unit. On the workflow flag because rules/workflow.md's handoff order is what fires
// optimize unprompted. perf's upstream is brooklyn-skills; see README for attribution.
export const OPTIMIZE_SKILLS = ['optimize', 'perf'];
export const OPTIMIZE_FILES = ['SKILL.md'];

// The upgrade path update-check.mjs points at, as one command. Ships by default: an
// upgrade tool behind a flag is one nobody has when the update notice arrives. Its
// frontmatter carries disable-model-invocation, so only the user can start it.
export const UPGRADE_SKILL = 'consig-upgrade';
export const UPGRADE_FILES = ['SKILL.md'];

// The deletion pass for rules/coding-discipline.md, which is already a default rule.
// A prompt file with no runtime cost and no plugin dependency, so it ships by default
// rather than behind a flag — inert until you run /yagni.
export const YAGNI_SKILL = 'yagni';
export const YAGNI_FILES = ['SKILL.md'];

// obra/superpowers's debugging process, plus the three techniques SKILL.md points at by
// filename and the two scripts they reference. Model-invoked on any bug, so it ships by
// default — the executor cannot ask for it if it is not there. See README for attribution.
export const DEBUGGING_SKILL = 'systematic-debugging';
export const DEBUGGING_FILES = [
  'SKILL.md', 'root-cause-tracing.md', 'defense-in-depth.md', 'condition-based-waiting.md',
  'find-polluter.sh', 'condition-based-waiting-example.ts',
];

// mattpocock's wizard generator: SKILL.md authors the stages, template.sh is the library
// they run on, so either alone is useless. Default like yagni — inert until you run
// /wizard. See README for attribution.
export const WIZARD_SKILL = 'wizard';
export const WIZARD_FILES = ['SKILL.md', 'template.sh'];

// shadcn/ui's own skill, with this repo's edits to its rules/*.md. Upstream is
// shadcn/ui; see the attribution in README.md. Nested paths, so copyAll() creates
// each file's directory rather than assuming a flat skill folder.
export const SHADCN_SKILL = 'shadcn';
export const SHADCN_FILES = [
  'SKILL.md', 'cli.md', 'customization.md', 'mcp.md', 'registry.md',
  'agents/openai.yml', 'assets/shadcn-small.png', 'assets/shadcn.png', 'evals/evals.json',
  'rules/base-vs-radix.md', 'rules/chat.md', 'rules/composition.md',
  'rules/forms.md', 'rules/icons.md', 'rules/styling.md',
];

// The environment this loop is tuned against. install.mjs fills in any key that is
// absent and never overwrites one you already set; doctor.mjs reports the gaps.
// Claude Code reads env at startup, so these take effect on the next `claude`.
export const RECOMMENDED_ENV = {
  CLAUDE_CODE_EFFORT_LEVEL: 'high',
  CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1',
  MAX_THINKING_TOKENS: '31999',
  CLAUDE_CODE_DISABLE_1M_CONTEXT: '1',
  CLAUDE_CODE_NO_FLICKER: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
  ANTHROPIC_CUSTOM_MODEL_OPTION: 'claude-fable-5-1',
  ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: 'Fable 5.1',
};
export const RECOMMENDED_SETTINGS = {
  includeCoAuthoredBy: false,
  alwaysThinkingEnabled: true,
};

// A third-party MCP server (ELv2, github.com/mksglu/context-mode) that keeps raw tool
// output out of the context window. This package never enables it for you: writing the
// plugin entries by file edit would skip the trust prompt Claude Code shows when you
// install someone else's plugin, and that prompt is the point. install.mjs prints the
// two commands, doctor.mjs reports whether you ran them.
export const CONTEXT_MODE = {
  plugin: 'context-mode',
  commands: ['/plugin marketplace add mksglu/context-mode', '/plugin install context-mode@context-mode'],
  verify: '/context-mode:ctx-doctor',
  statusLine: { type: 'command', command: 'context-mode statusline' },
  // Filled only when the plugin is enabled: quiets its per-command routing nudges on
  // short Bash calls and thins the external-MCP reminder, without touching the
  // curl/wget flood interception that is the plugin's actual saving.
  env: {
    CONTEXT_MODE_BASH_NUDGE_MIN_COMMAND_BYTES: '200',
    CONTEXT_MODE_EXTERNAL_MCP_NUDGE_EVERY: '50',
  },
};

// [event, matcher, script] — matcher null means the block carries no matcher.
// git-discipline and comment-ratio register unconditionally but self-gate at runtime on
// the rule file they enforce (workflow.md / coding-discipline.md), so a default install
// carries them inert rather than the installer growing per-flag entry bookkeeping.
export const HOOK_ENTRIES = [
  ['PreToolUse', 'Task|SendMessage', 'advisor-mark.mjs'],
  ['PreToolUse', 'Edit|Write|MultiEdit', 'advisor-gate.mjs'],
  ['PreToolUse', 'Bash', 'commit-language.mjs'],
  ['PreToolUse', 'Bash', 'git-discipline.mjs'],
  ['PreToolUse', 'Skill', 'git-discipline.mjs'],
  ['UserPromptSubmit', null, 'advisor-inject.mjs'],
  ['UserPromptSubmit', null, 'git-discipline.mjs'],
  ['PostToolUse', 'Edit|Write|MultiEdit', 'comment-ratio.mjs'],
  ['SessionStart', null, 'update-check.mjs'],
];

export { cfgDir as claudeDir } from './hooks/config-dir.mjs';

// the exact command the installer writes into settings.json
export function hookCommand(hooksDir, script) {
  return `node "${path.join(hooksDir, script)}"`;
}

export function hasRalphLoop(claudeDir) {
  return [
    path.join(claudeDir, 'plugins', 'cache', 'claude-plugins-official', 'ralph-loop'),
    path.join(claudeDir, 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins', 'ralph-loop'),
  ].some((p) => fs.existsSync(p));
}

// Enabled by the user through /plugin, so the record of it is theirs, not ours to write.
export function hasContextMode(settings) {
  return Object.entries(settings?.enabledPlugins || {})
    .some(([name, on]) => on && name.startsWith(`${CONTEXT_MODE.plugin}@`));
}
