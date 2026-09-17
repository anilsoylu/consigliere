#!/usr/bin/env node
// Checks the shape of a review, never the code it reviewed. The assertion list is fixed, it
// runs once, and its result goes to root — never back to the reviewer. That missing edge is
// what stops a mismatch from opening another review round.

import { readFileSync } from 'node:fs'

const [diffPath, findingsPath] = process.argv.slice(2)
if (!diffPath || !findingsPath) {
  console.error('usage: review-lint.mjs <diff-file> <findings-json>')
  process.exit(2)
}

const CAPS = { ADOPT: 5, NOTE: 3 }

// path -> [[start, end], …] over the post-image, the side a finding cites.
const hunks = new Map()
let file = null
for (const line of readFileSync(diffPath, 'utf8').split('\n')) {
  const plus = line.match(/^\+\+\+ (?:b\/)?(.+?)(?:\t.*)?$/)
  if (plus) {
    file = plus[1]
    hunks.set(file, [])
    continue
  }
  const at = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))?/)
  if (at && file) {
    const start = +at[1]
    hunks.get(file).push([start, start + (at[2] === undefined ? 1 : +at[2]) - 1])
  }
}

const findings = JSON.parse(readFileSync(findingsPath, 'utf8'))
const problems = []
const counts = {}

for (const f of findings) {
  counts[f.label] = (counts[f.label] || 0) + 1
  if (!(f.label in CAPS)) problems.push(`label "${f.label}" is neither ADOPT nor NOTE — ${f.file}:${f.line}`)

  const cited = [...hunks.keys()].find((p) => p === f.file || p.endsWith(`/${f.file}`) || f.file.endsWith(`/${p}`))
  if (!cited) {
    problems.push(`${f.file} is not in the diff that was reviewed`)
    continue
  }
  const start = parseInt(String(f.line), 10)
  if (!Number.isNaN(start) && !hunks.get(cited).some(([a, b]) => start >= a && start <= b))
    problems.push(`${f.file}:${f.line} is outside every changed hunk`)
}

for (const [label, cap] of Object.entries(CAPS))
  if ((counts[label] || 0) > cap) problems.push(`${counts[label]} ${label} findings, cap is ${cap}`)

for (const p of problems) console.log(p)

// Shadow mode: it reports, it does not gate. The exit code stays 0 until it has run clean on
// enough real reviews to have earned one.
process.exit(0)
