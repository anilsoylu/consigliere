#!/usr/bin/env node
// PreToolUse hook for `doctor.mjs --probe` only, registered through that run's own
// --settings file: it records the payload orchestrator-gate.mjs reads, so the agent_id
// assumption can be checked against the Claude Code build actually installed.
import fs from 'node:fs';

let record;
try {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  record = {
    agent_id: payload.agent_id,
    agent_type: payload.agent_type,
    tool_name: payload.tool_name,
    command: payload.tool_input?.command,
  };
// A recorded parse failure is what separates "the hook never ran" from "the payload changed shape".
} catch { record = { parse_error: true }; }

fs.appendFileSync(process.argv[2], JSON.stringify(record) + '\n');
