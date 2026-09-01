// Where Claude Code keeps its config. Honoring CLAUDE_CONFIG_DIR in only some places is
// worse than ignoring it everywhere: the installer writes where the harness never looks
// while the doctor, reading the same wrong path, reports a healthy install.
//
// It lives in hooks/ rather than beside manifest.mjs because the hooks are copied into
// <config>/hooks with no manifest next to them; manifest.mjs imports it back, so the rule
// has one definition instead of one per caller.
import os from 'node:os';
import path from 'node:path';

export function cfgDir() {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  if (!configured || configured.trim() === '') return path.join(os.homedir(), '.claude');
  return configured.startsWith('~')
    ? path.resolve(os.homedir(), configured.replace(/^~[/\\]?/, ''))
    : path.resolve(configured);
}
