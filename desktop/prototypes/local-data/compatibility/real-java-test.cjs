// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict'
// Functional integration only. Caller must launch and own an isolated Java child.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createJavaAuthority } = require('./java-authority.cjs')
const args = Object.fromEntries(process.argv.slice(2).reduce((list, value, index, all) => {
  if (index % 2 === 0) list.push([value.replace(/^--/, ''), all[index + 1]])
  return list
}, []))
for (const key of ['base-url', 'expected-build', 'expected-storage-root', 'fixture-root']) {
  if (!args[key]) throw new Error(`Missing --${key}`)
}
const root = path.resolve(args['fixture-root'])
const expectedStorage = path.resolve(args['expected-storage-root'])
if (root === path.parse(root).root || expectedStorage === path.parse(expectedStorage).root) throw new Error('Isolated roots required')
const notes = []
const record = (name, details = {}) => { notes.push({ name, ...details }); process.stdout.write(JSON.stringify(notes.at(-1)) + '\n') }
const api = async (route, method = 'GET', body) => {
  const response = await fetch(args['base-url'] + route, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200, route)
  const value = await response.json()
  if (Object.hasOwn(value, 'code')) { assert.ok(value.code === 0 || value.code === 200, JSON.stringify(value)); return value.data ?? value }
  return value
}

async function main() {
  const health = await api('/api/desktop/health')
  assert.equal(health.build, args['expected-build'], 'Refusing a backend not owned by this test run')
  assert.equal(health.status, 'UP')
  const location = await api('/api/storage/location')
  assert.equal(path.resolve(location.path), expectedStorage, 'Refusing a backend with different storage')
  // No filesystem or database mutation occurs before the two ownership checks above.
  await fs.mkdir(root, { recursive: false })
  await fs.writeFile(path.join(root, '.synthetic-compatibility-fixture'), 'Synthetic documents only\n', { flag: 'wx' })
  const localRoot = path.join(root, 'old-local-project')
  await fs.mkdir(localRoot)
  const original = Buffer.from('合成旧项目原文\nOriginal retained project identity\n')
  await fs.writeFile(path.join(localRoot, 'contract.txt'), original)
  const opened = await api('/api/projects/open-local', 'POST', { localRoot, createFolder: false, name: 'Synthetic existing project' })
  const projectId = opened.projectId
  assert.ok(Number.isSafeInteger(projectId))
  await api(`/api/projects/${projectId}/version/enable`, 'POST', {})
  let adapter
  const events = []
  const options = { baseUrl: args['base-url'], expectedBuild: args['expected-build'], profileId: path.basename(root), cacheDirectory: path.join(root, 'cache'),
    editor: {
      // No document engine is open in this API-level test. Native-model ACKs require root's UI test.
      flush: async c => { events.push({ phase: 'flush', ...c }); return true },
      close: async c => { events.push({ phase: 'close', ...c }); return { ok: true, operationId: c.operationId, closed: true } },
      reload: async c => { for (const fileId of c.affectedFileIds) await adapter.readFile(c.projectId, fileId); events.push({ phase: 'reload', ...c }); return { ok: true, operationId: c.operationId } }
    } }
  adapter = createJavaAuthority(options)
  try {
    const initial = await adapter.snapshot()
    const project = initial.projects.find(p => p.id === projectId)
    assert.ok(project)
    const file = project.files.find(f => f.name === 'contract.txt')
    assert.ok(file?.uid)
    record('import-real-original-identities', { projectId, fileId: file.id, fileUid: file.uid })
    assert.deepEqual((await adapter.readFile(projectId, file.id)).bytes, original)
    const first = Buffer.from('合成第一版\nVersion one retained through Java Git\n')
    await adapter.saveFile(projectId, file.id, first)
    const v1 = await adapter.createVersion(projectId, { title: 'Synthetic named version one' })
    assert.ok(v1.sha, JSON.stringify(v1))
    const second = Buffer.from('合成第二版\nVersion two then restore\n')
    await adapter.saveFile(projectId, file.id, second)
    const v2 = await adapter.createVersion(projectId, { title: 'Synthetic named version two' })
    assert.ok(v2.sha && v2.sha !== v1.sha)
    const history = await adapter.history(projectId, file.id)
    assert.ok(history.entries.some(e => e.sha === v1.sha))
    assert.ok(history.entries.some(e => e.sha === v2.sha))
    record('real-java-version-history', { firstSha: v1.sha, secondSha: v2.sha, entries: history.entries.length })
    const restored = await adapter.restore(projectId, { ref: v1.sha })
    assert.ok(restored.sha && restored.sha !== v1.sha)
    assert.deepEqual((await adapter.readFile(projectId, file.id)).bytes, first)
    assert.deepEqual(await fs.readFile(path.join(localRoot, 'contract.txt')), first)
    assert.deepEqual((await adapter.blockedOperations()), [])
    record('real-git-revert-new-commit', { sha: restored.sha, affectedFileIds: restored.affectedFileIds, callbacks: events })
    const again = await adapter.snapshot()
    assert.equal(again.projects.find(p => p.id === projectId).files.find(f => f.id === file.id).uid, file.uid)
    await adapter.clearCache()
    assert.equal(await adapter.cachedSnapshot(), null)
    await adapter.close()
    adapter = createJavaAuthority(options)
    assert.deepEqual((await adapter.readFile(projectId, file.id)).bytes, first)
    assert.ok((await adapter.history(projectId, file.id)).entries.some(e => e.sha === restored.sha))
    const reopen = await api('/api/projects/open-local', 'POST', { localRoot, createFolder: false })
    assert.equal(reopen.projectId, projectId)
    record('cache-deletion-and-adapter-reopen-preserve-data-history', { projectId, fileId: file.id, uid: file.uid })
    await fs.writeFile(path.join(root, 'summary.json'), JSON.stringify({ passed: true, scope: 'real isolated Java/H2/Git APIs; no native editor, AI checkpoint or performance claim', notes }, null, 2) + '\n')
  } finally { await adapter.close() }
}
main().catch(async error => {
  process.stderr.write(error.stack + '\n')
  try { await fs.writeFile(path.join(root, 'failure.json'), JSON.stringify({ message: error.message, code: error.code, notes }, null, 2)) } catch {}
  process.exitCode = 1
})
