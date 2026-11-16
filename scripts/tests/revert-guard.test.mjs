// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '../ci/revert-guard.sh')

// Throwaway repo: c0 (a=1,b=1) -> A (a=2, adds new.txt) on master; a "PR" branch from c0.
function setup() {
  const d = mkdtempSync(join(tmpdir(), 'revert-guard-'))
  const git = (...a) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim()
  const put = (f, c) => writeFileSync(join(d, f), c)
  const commit = (m) => { git('add', '-A'); git('commit', '-q', '-m', m); return git('rev-parse', 'HEAD') }
  git('init', '-q', '-b', 'master')
  put('a', '1\n'); put('b', '1\n')
  const c0 = commit('c0')
  put('a', '2\n'); put('new.txt', 'n\n')
  const A = commit('feat A')
  return { d, git, put, commit, c0, A }
}
const run = (d, base, head, body = '') =>
  spawnSync('bash', [script, base, head], { cwd: d, env: { ...process.env, PR_BODY: body }, encoding: 'utf8' })

test('normal change passes', () => {
  const s = setup()
  try {
    s.git('checkout', '-q', '-b', 'pr')
    s.put('b', '2\n')
    const head = s.commit('edit b')
    const r = run(s.d, s.A, head)
    assert.equal(r.status, 0, r.stdout + r.stderr)
  } finally { rmSync(s.d, { recursive: true, force: true }) }
})

test('stale-base squash that reverts a recent commit fails', () => {
  const s = setup()
  try {
    // Squash built on top of master but with the stale tree of c0 plus an edit to b.
    s.put('a', '1\n'); s.put('b', '2\n'); rmSync(join(s.d, 'new.txt'))
    const head = s.commit('stale squash')
    const r = run(s.d, s.A, head)
    assert.equal(r.status, 1, r.stdout)
    assert.match(r.stdout, new RegExp(s.A.slice(0, 9)))
  } finally { rmSync(s.d, { recursive: true, force: true }) }
})

test('intentional revert with allow line passes; wrong sha does not', () => {
  const s = setup()
  try {
    s.put('a', '1\n')
    s.put('new.txt', 'n\n')
    const head = s.commit('revert A on purpose')
    assert.equal(run(s.d, s.A, head, `why\nrevert-guard: allow ${s.A.slice(0, 9)}\n`).status, 0)
    assert.equal(run(s.d, s.A, head, 'revert-guard: allow deadbee\n').status, 1)
    assert.equal(run(s.d, s.A, head, '').status, 1)
  } finally { rmSync(s.d, { recursive: true, force: true }) }
})

test('deleting a recently added file fails', () => {
  const s = setup()
  try {
    rmSync(join(s.d, 'new.txt'))
    const head = s.commit('drop new.txt')
    const r = run(s.d, s.A, head)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /new\.txt \(deleted\)/)
  } finally { rmSync(s.d, { recursive: true, force: true }) }
})
