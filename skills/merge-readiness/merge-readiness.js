export const meta = {
  name: 'merge-readiness',
  description: 'Review a diff across four lenses, then judge every finding with a stronger model than found it',
  whenToUse: 'Large or risky diffs where a single review pass is not enough. Run above the review-tier.sh tiers, not instead of them.',
  phases: [
    { title: 'Baseline', detail: 'run the verifier before reviewing anything' },
    { title: 'Audit', detail: 'four lenses read the diff in parallel' },
    { title: 'Verify', detail: 'opus xhigh tries to refute each finding' },
    { title: 'Escalate', detail: 'fable settles the disputed ones' },
    { title: 'Triage', detail: 'rank what survived' },
  ],
}

// Fable never writes code. It only ever returns a verdict.
// xhigh only ever sits on nodes that return a verdict, never on nodes that emit code.

const base = (args && args.base) || 'origin/HEAD'
const verifyCmd = (args && args.verify) || null

// Prepended to every prompt whose agent runs git or resolves a file path. The judges
// need it as much as the audit does: they read the surrounding code themselves, so a
// wrong cwd refutes real findings instead of failing.
const inDir = (args && args.cwd)
  ? `Work in ${args.cwd}. Run every command and resolve every path from there.\n\n`
  : ''

const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'severity', 'claim'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { enum: ['critical', 'high', 'medium', 'low'] },
          claim: { type: 'string', description: 'the defect in one sentence' },
          evidence: { type: 'string', description: 'the diff hunk it lives in' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['real', 'confidence', 'why'],
  properties: {
    real: { type: 'boolean' },
    confidence: { enum: ['high', 'low'] },
    why: { type: 'string', description: 'at most three sentences' },
  },
}

const LENSES = [
  { key: 'security', brief: 'authn/authz, injection, secrets, unsafe deserialization, SSRF' },
  { key: 'data-migration', brief: 'schema changes, destructive migrations, data loss, backfill ordering' },
  { key: 'api-contract', brief: 'breaking response/request shapes, nullability, versioning, client assumptions' },
  { key: 'perf', brief: 'N+1 queries, unbounded loops, missing indexes, blocking IO on hot paths' },
]

// ---- Baseline -------------------------------------------------------------
// The oracle is the exit code, not a model's opinion. The agent is only the runner.
// It also resolves the diff base, because this is the only node with a shell and an
// unresolvable base has to abort the run rather than hand four lenses an empty diff.
phase('Baseline')
const baseline = await agent(
  `${inDir}Two jobs, both on the CURRENT working tree. Report raw results; fix nothing.

1. Resolve the diff base. Try \`git rev-parse --verify ${base}\`. If that fails, fall back in
order: origin/main, origin/master, main, master, and finally the merge-base with whatever
remote branch this one tracks. Report the ref that actually resolved, and the number of files
in \`git diff --name-only <that ref>...HEAD\`. If nothing resolves, report resolvedBase "".

2. Run the project's verifier.
${verifyCmd ? `The command is: ${verifyCmd}` : 'Find it yourself: package.json scripts (test/typecheck/lint), Makefile, or justfile. Prefer the narrowest one that actually compiles and tests the code.'}
Report the exact command you ran and its exit code. Do not interpret a failure as acceptable.`,
  {
    label: 'baseline-gates',
    phase: 'Baseline',
    model: 'sonnet',
    effort: 'low',
    schema: {
      type: 'object',
      required: ['command', 'exitCode', 'resolvedBase', 'changedFiles'],
      properties: {
        command: { type: 'string' },
        exitCode: { type: 'integer' },
        resolvedBase: { type: 'string', description: 'the ref that resolved, or "" if none did' },
        changedFiles: { type: 'integer' },
        summary: { type: 'string' },
      },
    },
  },
)

if (!baseline || baseline.exitCode !== 0) {
  log(`baseline is red (${baseline ? baseline.command + ' -> ' + baseline.exitCode : 'runner failed'}) — reviewing a broken tree wastes the run`)
  return { aborted: 'baseline-failed', baseline }
}

// A review that reports "nothing found" because its diff command errored is worse than
// no review at all, so an unresolved base or an empty range stops the run out loud.
if (!baseline.resolvedBase || !baseline.changedFiles) {
  log(baseline.resolvedBase
    ? `${baseline.resolvedBase}...HEAD is empty — there is nothing to review`
    : `could not resolve a diff base (tried ${base} and the usual fallbacks) — pass args.base explicitly`)
  return { aborted: baseline.resolvedBase ? 'empty-diff' : 'unresolved-base', baseline }
}

const range = `${baseline.resolvedBase}...HEAD`

// ---- Audit ----------------------------------------------------------------
phase('Audit')
const audits = await parallel(
  LENSES.map((l) => () =>
    agent(
      `${inDir}Review the diff \`git diff ${range}\` through ONE lens only: ${l.key} — ${l.brief}.
Ignore everything outside your lens; another reviewer owns it.
Report every defect you find, no severity filter. For each one include the diff hunk it lives in as evidence.
Do not propose fixes. Do not write code.`,
      { label: `audit:${l.key}`, phase: 'Audit', model: 'opus', effort: 'high', schema: FINDINGS },
    ),
  ),
)

// Barrier is deliberate: two lenses routinely flag the same line, and deduping
// before spending the expensive judges is the whole point.
const RANK = { critical: 0, high: 1, medium: 2, low: 3 }

// Identity is the location alone. Severity must stay out of the key: two lenses
// rating the same defect differently would both survive and burn two of the scarce
// verification slots. The lenses are disjoint by construction, so the same line
// flagged twice is far more likely one defect than two — and losing a slot to a
// duplicate costs more than merging two findings that happened to share a line.
const byLocation = new Map()
for (const f of audits.filter(Boolean).flatMap((a) => a.findings || [])) {
  const k = `${f.file}:${f.line}`
  const prev = byLocation.get(k)
  if (!prev || RANK[f.severity] < RANK[prev.severity]) byLocation.set(k, f)
}
const deduped = [...byLocation.values()]

if (!deduped.length) return { baseline, findings: [], note: 'four lenses found nothing' }

const ordered = [...deduped].sort((a, b) => RANK[a.severity] - RANK[b.severity])

const TIER1_CAP = 5
const forVerify = ordered.slice(0, TIER1_CAP)
if (ordered.length > TIER1_CAP) {
  log(`${ordered.length} findings, verifying the top ${TIER1_CAP} by severity — ${ordered.length - TIER1_CAP} went unverified`)
}

// ---- Verify ---------------------------------------------------------------
// tier-1 rises on the EFFORT axis: same model as the author, more thinking.
// It is blind to the author's reasoning on purpose — a judge that reads the
// justification anchors to it and approves.
const judged = await pipeline(
  forVerify,
  (f) =>
    agent(
      `${inDir}A reviewer claims this is a defect. Try to REFUTE it.

File: ${f.file}:${f.line}
Claim: ${f.claim}
Hunk:
${f.evidence || `(not captured — read it with git diff ${range})`}

You have not been told why the reviewer believes this, and you should not go looking for their reasoning.
Read the surrounding code and decide for yourself. If you cannot establish that the defect is real, mark it not real.
Default to refuted when uncertain. Return a verdict only — do not write code.`,
      { label: `verify:${f.file}`, phase: 'Verify', model: 'opus', effort: 'xhigh', schema: VERDICT },
    ).then((v) => ({ ...f, tier1: v })),
)

// ---- Escalate -------------------------------------------------------------
// tier-2 rises on the MODEL axis instead, and steps effort back down.
// Never pay for both axes on the same call.
const disputed = judged
  .filter(Boolean)
  .filter((f) => f.tier1 && (f.tier1.confidence === 'low' || ((f.severity === 'critical' || f.severity === 'high') && f.tier1.real)))

const TIER2_CAP = 2
const escalate = disputed.slice(0, TIER2_CAP)
if (disputed.length > TIER2_CAP) {
  log(`${disputed.length} findings warranted escalation, sending the top ${TIER2_CAP} to fable — ${disputed.length - TIER2_CAP} rest on the tier-1 verdict`)
}

phase('Escalate')
const settled = await parallel(
  escalate.map((f) => () =>
    agent(
      `${inDir}You are the last word on this finding. A previous judge already ruled; your job includes judging that ruling.

File: ${f.file}:${f.line}
Claim: ${f.claim}
Hunk:
${f.evidence || `(not captured — read it with git diff ${range})`}

Previous judge said real=${f.tier1.real} (confidence ${f.tier1.confidence}): ${f.tier1.why}

Do not defer to that. Assume it is wrong until the code shows otherwise, and say so if it is.
Default to refuted when uncertain. Return a verdict only — do not write code.`,
      { label: `settle:${f.file}`, phase: 'Escalate', model: 'fable', effort: 'high', schema: VERDICT },
    ).then((v) => ({ ...f, tier2: v })),
  ),
)

const byKey = new Map(settled.filter(Boolean).map((f) => [`${f.file}:${f.line}`, f]))
const final = judged.filter(Boolean).map((f) => byKey.get(`${f.file}:${f.line}`) || f)
const confirmed = final.filter((f) => (f.tier2 ? f.tier2.real : f.tier1 && f.tier1.real))

if (!confirmed.length) return { baseline, findings: [], note: 'every finding was refuted' }

// ---- Triage ---------------------------------------------------------------
phase('Triage')
const ranked = await agent(
  `Rank these confirmed findings by what a reviewer should fix first. Merge any that are the same underlying defect.
Do not re-litigate whether they are real — that is settled. Do not write fixes.

${JSON.stringify(confirmed.map((f) => ({ file: f.file, line: f.line, severity: f.severity, claim: f.claim })), null, 1)}`,
  {
    label: 'triage',
    phase: 'Triage',
    model: 'sonnet',
    effort: 'medium',
    schema: {
      type: 'object',
      required: ['ranked'],
      properties: {
        ranked: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'line', 'severity', 'claim'],
            properties: {
              file: { type: 'string' },
              line: { type: 'integer' },
              severity: { enum: ['critical', 'high', 'medium', 'low'] },
              claim: { type: 'string' },
            },
          },
        },
      },
    },
  },
)

return {
  baseline,
  audited: deduped.length,
  verified: forVerify.length,
  escalated: escalate.length,
  findings: (ranked && ranked.ranked) || confirmed,
}
