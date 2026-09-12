// What Consigliere installs and where it looks for its dependencies.
// install.mjs, uninstall.mjs, and doctor.mjs all read this, so the three cannot drift.
import fs from 'node:fs';
import path from 'node:path';

// Releases are `git tag v<VERSION>`; update-check.mjs and doctor.mjs both compare against
// that tag list, so bumping this without tagging makes an installed copy look ahead of
// upstream. Only vN.N.N sorts — the old `v1-sol` tag is deliberately unsortable.
export const VERSION = '2.6.0';
export const STATE_FILE = '.consigliere-state.json';

export const HOOK_FILES = [
  // First, and with no HOOK_ENTRIES lines of their own: modules the hooks import rather than
  // hooks, and copying them after their importers leaves an upgrade window where an import throws.
  'config-dir.mjs', 'approval.mjs',
  'orchestrator-gate.mjs', 'commit-language.mjs',
  'update-check.mjs', 'review-tier.mjs', 'git-discipline.mjs', 'read-gate.mjs', 'comment-ratio.mjs',
  'plan-capture.mjs',
];
// Files an earlier version installed and this one does not. Dropping a name from
// HOOK_FILES alone leaves an orphan nothing removes and doctor no longer looks at, so
// install.mjs deletes these and uninstall.mjs sweeps them.
export const OBSOLETE_HOOK_FILES = ['review-tier.sh', 'advisor-inject.mjs', 'advisor-mark.mjs', 'advisor-gate.mjs'];
// Same reason, for the other two directories: the advisor loop this version replaced.
export const OBSOLETE_AGENT_FILES = ['advisor.md'];
export const OBSOLETE_RULE_FILES = ['advisor-executor.md'];
export const DEFAULT_RULES = ['orchestrator.md', 'coding-discipline.md'];
export const WORKFLOW_RULE = 'workflow.md';

// Six of the seven roles, as subagent definitions; `fork` is built in. orchestrator-gate.mjs blocks the
// root's source edits and names these roles as the way through, so a gate installed
// without the agents is a lock with no key. Same missing/modified treatment as a hook.
export const AGENT_FILES = ['worker.md', 'tester.md', 'explorer.md', 'reader.md', 'researcher.md', 'reviewer.md'];

// The merge-readiness skill and the Workflow script it invokes are one feature: the
// skill reads the script from beside it, so either one alone is a dangling reference.
export const MERGE_READINESS_SKILL = 'merge-readiness';
export const MERGE_READINESS_FILES = ['SKILL.md', 'merge-readiness.js'];

// The skills rules/workflow.md orders by name — polish the diff, open or refresh the PR,
// unblock a stuck one. They share ralph-protocol's --with-workflow gate, because the rule
// that names them is on that flag and a rule naming an absent skill is the same dangling
// reference as a gate with no agent. Upstream is brooklyn-skills; see the attribution in
// README.md. `cpr` is the handoff's last step: clean then pr-update in one pass.
export const HANDOFF_SKILLS = ['cpr', 'clean', 'pr-update', 'pr-ready'];
export const HANDOFF_FILES = ['SKILL.md'];

// mattpocock's grilling interview, shipped as its upstream pair: `grilling` carries the
// doctrine, `grill-me` is the user-only slash wrapper that runs it, so either alone is a
// dangling reference. Default, not flagged: a prompt file with no runtime cost, inert
// until something invokes it. See README for attribution.
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

// One bounded contract from implementation to a judged, verified result: SKILL.md tells the
// root how to call it, the script beside it is what runs. Ships by default because the three
// roles it spawns are default agents, and a prompt file plus a script costs nothing until a
// Workflow call reads them.
export const IMPLEMENT_SKILL = 'implement-review-verify';
export const IMPLEMENT_FILES = ['SKILL.md', 'implement-review-verify.js'];

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
  CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1',
  MAX_THINKING_TOKENS: '31999',
  CLAUDE_CODE_DISABLE_1M_CONTEXT: '1',
  CLAUDE_CODE_NO_FLICKER: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1',
};
export const RECOMMENDED_SETTINGS = {
  includeCoAuthoredBy: false,
  alwaysThinkingEnabled: true,
  // The root must be the most capable model for the topology to mean anything: it decides
  // and delegates, and the Opus subagents execute. Filled only when you have no value.
  model: 'claude-fable-5-1',
  // A subagent's prompt is cached for 5 minutes by default, which a delegation that waits
  // on a sibling routinely outlives; re-delegating to the same agent then pays full price.
  subagentPromptCacheTtl: '1h',
  // Above every agent file's own `effort:`, so it caps nothing the ladder asks for and stops
  // a stray /effort from spending xhigh on every call.
  maxEffortLevel: 'high',
};

// Auto mode denies push, merge and tag from workers without these; opt-in via --with-release-permissions.
export const RELEASE_PERMISSIONS = [
  'Bash(git push:*)',
  'Bash(git tag:*)',
  'Bash(gh pr create:*)',
  'Bash(gh pr ready:*)',
  'Bash(gh pr edit:*)',
  'Bash(gh pr merge:*)',
  'Bash(gh pr reopen:*)',
  'Bash(gh release create:*)',
];

// [event, matcher, script] — matcher null means the block carries no matcher.
// orchestrator-gate, git-discipline and comment-ratio register unconditionally but
// self-gate at runtime on the rule file they enforce (orchestrator.md / workflow.md /
// coding-discipline.md), so a default install carries them inert rather than the installer
// growing per-flag entry bookkeeping. orchestrator-gate leads the Bash block: it decides
// whether the root may run the command at all.
// plan-capture is the one hook that writes into your working tree: an approved plan-mode
// plan lands in `plans/` at the repo root, which it creates when absent.
export const HOOK_ENTRIES = [
  ['PreToolUse', 'Edit|Write|MultiEdit', 'orchestrator-gate.mjs'],
  ['PreToolUse', 'Bash', 'orchestrator-gate.mjs'],
  ['PreToolUse', 'Bash', 'commit-language.mjs'],
  ['PreToolUse', 'Bash', 'git-discipline.mjs'],
  ['PreToolUse', 'Read', 'read-gate.mjs'],
  ['PreToolUse', 'Bash', 'read-gate.mjs'],
  ['PreToolUse', 'Skill', 'git-discipline.mjs'],
  ['PostToolUse', 'Bash', 'git-discipline.mjs'],
  ['SessionStart', null, 'git-discipline.mjs'],
  ['UserPromptSubmit', null, 'git-discipline.mjs'],
  ['PostToolUse', 'Edit|Write|MultiEdit', 'comment-ratio.mjs'],
  ['PostToolUse', 'ExitPlanMode', 'plan-capture.mjs'],
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
