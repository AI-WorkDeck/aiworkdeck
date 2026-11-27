// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every JS/TS test file in the repo must be run by some CI workflow (dev-board#1840): 154 of 876 had silently
// never run, and a few had gone red. Add a new test to an existing npm script or CI step; if it truly cannot run in
// CI, name it in scripts/ci/test-reachability-exclusions.json with the reason.
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { pathToFileURL } = require('url')

const repo = path.join(__dirname, '..', '..')

// A repo-structure check: running it on Linux CI is enough (Windows paths would only add noise).
test('every test file is reachable from a CI workflow (or excluded with a reason)', { skip: process.platform === 'win32' && 'repo-structure check; runs on Linux' }, async () => {
  const { reachability } = await import(pathToFileURL(path.join(repo, 'scripts/ci/test-reachability.mjs')).href)
  const r = reachability(repo)
  assert.deepStrictEqual(r.orphans, [],
    `${r.orphans.length} test file(s) no workflow runs. Wire them into an npm script/CI step, or exclude them with a reason in scripts/ci/test-reachability-exclusions.json:\n  ${r.orphans.join('\n  ')}`)
  assert.deepStrictEqual(r.stale, [],
    `stale exclusions (match nothing, or files CI already runs); remove them from scripts/ci/test-reachability-exclusions.json: ${r.stale.join(', ')}`)
  assert.ok(r.covered > 800, `suspiciously few reachable tests (${r.covered}): the workflow parser may be broken`)
})
