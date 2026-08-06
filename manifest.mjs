// What Consigliere installs and where it looks for its dependencies.
// install.mjs, uninstall.mjs, and doctor.mjs all read this, so the three cannot drift.
import fs from 'node:fs';
import path from 'node:path';

export const HOOK_FILES = ['advisor-inject.mjs', 'advisor-mark.mjs', 'advisor-gate.mjs', 'review-tier.sh'];
export const DEFAULT_RULES = ['advisor-executor.md', 'coding-discipline.md'];
export const WORKFLOW_RULE = 'workflow.md';

// The advisor itself, as a Claude Code subagent definition. advisor-gate.mjs blocks
// source edits and names this subagent as the way through, so a gate installed without
// the agent is a lock with no key. It gets the same missing/modified treatment as a hook.
export const AGENT_FILES = ['advisor.md'];

// The merge-readiness skill and the Workflow script it invokes are one feature: the
// skill points at the script by path, so either one alone is a dangling reference.
export const MERGE_READINESS_SKILL = 'merge-readiness';
export const MERGE_READINESS_FILES = ['SKILL.md', 'merge-readiness.js'];

// The deletion pass for rules/coding-discipline.md, which is already a default rule.
// A prompt file with no runtime cost and no plugin dependency, so it ships by default
// rather than behind a flag — inert until you run /yagni.
export const YAGNI_SKILL = 'yagni';
export const YAGNI_FILES = ['SKILL.md'];

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
  ANTHROPIC_CUSTOM_MODEL_OPTION: 'claude-fable-5',
  ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: 'Fable 5',
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
};

// [event, matcher, script] — matcher null means the block carries no matcher
export const HOOK_ENTRIES = [
  ['PreToolUse', 'Task', 'advisor-mark.mjs'],
  ['PreToolUse', 'Edit|Write|MultiEdit', 'advisor-gate.mjs'],
  ['UserPromptSubmit', null, 'advisor-inject.mjs'],
];

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
