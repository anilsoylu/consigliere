export const meta = {
  name: 'implement-review-verify',
  description: 'Carry one bounded contract from implementation to a judged, verified result',
  whenToUse: 'A single delegable change whose contract is already written. Replaces the root spawning a worker, waiting, spawning a reviewer, waiting, spawning a tester.',
  phases: [
    { title: 'Implement', detail: 'the worker carries out the contract' },
    { title: 'Judge', detail: 'the reviewer reads the result while the tester runs the verifier' },
    { title: 'Fix', detail: 'one round for the ADOPT findings and a red verifier' },
  ],
}

// Every stage names an agentType instead of a model and an effort, so each one runs the
// installed role as ~/.claude/agents defines it and this file never restates that choice.

const contract = (args && args.contract) || ''
const verifyCmd = (args && args.verify) || null
const inDir = (args && args.cwd)
  ? `Work in ${args.cwd}. Run every command and resolve every path from there.\n\n`
  : ''

// The reviewer has no shell, so the change has to reach it as a file it can read.
const WRITE_DIFF = `

When the work is done, write the unified diff of your change to
/tmp/implement-review-verify/diff.patch, leaving the index alone: \`git diff HEAD\` for the
tracked files, then append \`git diff --no-index -- /dev/null <file>\` for each untracked one
(it exits 1 there, which is normal). Return that path as diffPath. It is the only thing the
reviewer will see of your change.`

// The patch is what gets judged; files is what the reviewer opens for the surrounding code.
const REPORT = {
  type: 'object',
  required: ['report', 'files', 'escalated', 'diffPath'],
  properties: {
    report: { type: 'string', description: 'the five-field report, at most 40 lines' },
    files: { type: 'array', items: { type: 'string' }, description: 'every path you changed' },
    escalated: { type: 'boolean', description: 'true if you returned the decision instead of implementing' },
    diffPath: { type: 'string', description: 'where you wrote the unified diff' },
  },
}

const REVIEW = {
  type: 'object',
  required: ['verdict', 'provisional', 'findings'],
  properties: {
    verdict: { enum: ['SHIP', 'FIX-FIRST', 'RETHINK'] },
    provisional: { type: 'boolean', description: 'true if a file you needed was unreadable' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'text'],
        properties: {
          label: { enum: ['ADOPT', 'DISCUSS', 'STYLE', 'OVER-ENGINEERED'] },
          text: { type: 'string', description: 'the finding in one or two sentences, with its file and line' },
        },
      },
    },
  },
}

const VERIFIED = {
  type: 'object',
  required: ['command', 'exit', 'summary'],
  properties: {
    command: { type: 'string' },
    exit: { type: 'integer' },
    summary: { type: 'string', description: 'pass/fail counts, and the failure lines if it is red' },
  },
}

const runVerifier = (label, stage) => agent(
  `${inDir}Run the verifier on the current working tree and report the raw result. Implement nothing.
${verifyCmd ? `The command is: ${verifyCmd}` : 'Pick the narrowest one that can fail: the touched files\' suite first, then their package. Look in package.json scripts, a Makefile, or a justfile.'}
Never pipe it through tail, head or grep — the filter's exit status hides a red run. Redirect to a log, read the exit code, then grep the log.`,
  { label, phase: stage, agentType: 'tester', schema: VERIFIED },
)

// ---- Implement ------------------------------------------------------------
phase('Implement')
const built = await agent(`${inDir}${contract}${WRITE_DIFF}`, {
  label: 'implement',
  phase: 'Implement',
  agentType: 'worker',
  schema: REPORT,
})

if (!built) {
  log('the worker returned nothing, so there is no result to judge')
  return { aborted: 'no-result' }
}

// An escalation means the tree is unchanged. Reviewing it would judge the old code and
// the verifier would report the state the run started in, both as if they meant something.
if (built.escalated) {
  log('the worker escalated instead of implementing, so review and verify have nothing to judge')
  return { aborted: 'escalated', workerReport: built.report }
}

// ---- Judge ----------------------------------------------------------------
// Barrier is deliberate: the fix round needs both answers, and neither depends on the other.
phase('Judge')
const patch = built.diffPath
  ? `Read the patch at ${built.diffPath} and judge only the hunks it holds. You have no shell, so that file is the change.`
  : 'The worker wrote no patch, so judge the files below as they stand and say so in your verdict.'
const fileList = built.files && built.files.length
  ? built.files.map((f) => `- ${f}`).join('\n')
  : '(the worker named none — say so in your verdict rather than guessing)'

const [review, verified] = await parallel([
  () => agent(
    `${inDir}${patch}

Open any of these files when you need the code around a hunk:

${fileList}

You have not been told why any of this was written the way it was, and you should not go looking for the reasoning: a judge that reads the justification anchors to it. Report everything you find, with no severity filter. Label a finding ADOPT only when you can name the defect and the line it is on. Do not write code.`,
    { label: 'review', phase: 'Judge', agentType: 'reviewer', schema: REVIEW },
  ),
  () => runVerifier('verify', 'Judge'),
])

if (!review) log('the reviewer returned no verdict, so only the verifier stands behind this result')

// ---- Fix ------------------------------------------------------------------
const verdict = review ? review.verdict : null
const findings = (review && review.findings) || []
const adopt = findings.filter((f) => f.label === 'ADOPT')
const red = !!verified && verified.exit !== 0
let fixReport = null
let settled = verified

// A runner that returned nothing is not evidence of a red tree. With no finding to carry,
// one more run settles it, where a fix worker would be guessing at what to change.
if (!verified && !adopt.length) {
  log('the verifier returned no result and nothing was flagged ADOPT, re-running it once instead of opening a fix round')
  settled = await runVerifier('verify-retry', 'Judge')
}

const fixRound = adopt.length > 0 || red

if (fixRound) {
  log(`fix round: ${adopt.length} ADOPT finding(s)${red ? `, verifier exit ${verified.exit}` : ''} — one round, then the run stops either way`)
  phase('Fix')
  const fixed = await agent(
    `${inDir}${contract}

That contract has already been carried out once. Two judgements came back on the result. Close them and change nothing else.

ADOPT findings:
${adopt.length ? adopt.map((f) => `- ${f.text}`).join('\n') : '(none)'}

Verifier: ${verified ? `\`${verified.command}\` exited ${verified.exit}. ${verified.summary}` : 'the run produced no result'}

Do not widen the change and do not re-review it.${WRITE_DIFF}`,
    { label: 'fix', phase: 'Fix', agentType: 'worker', schema: REPORT },
  )
  if (!fixed || fixed.escalated) {
    log(fixed
      ? 'the fix worker escalated instead of closing the findings, so there is nothing new to verify'
      : 'the fix worker returned nothing, so there is nothing new to verify')
    return {
      aborted: fixed ? 'fix-escalated' : 'fix-no-result',
      verdict,
      findings,
      verifierExit: verified ? verified.exit : null,
      workerReport: built.report,
      fixReport: fixed ? fixed.report : null,
    }
  }

  fixReport = fixed.report
  settled = await runVerifier('verify-after-fix', 'Fix')
  if (!settled || settled.exit !== 0) {
    log(`still red after the fix round (${settled ? `${settled.command} -> ${settled.exit}` : 'the runner returned nothing'}), stopping instead of trying again`)
  }
}

return {
  verdict,
  provisional: review ? review.provisional : true,
  findings,
  verifierExit: settled ? settled.exit : null,
  fixRound,
  workerReport: built.report,
  fixReport,
}
