// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createImportBatch, runImportBatch, walkDropEntries } from '../../src/utils/chatImportBatch.js'
import { admitFileToContext } from '../../src/utils/chatContextLimits.js'

test('500 independent references are retained, duplicates still rejected', () => {
  const files = []
  for (let id = 1; id <= 500; id++) {
    assert.equal(admitFileToContext({ file: { id }, contextFiles: files }).ok, true)
    files.push({ id })
  }
  assert.equal(admitFileToContext({ file: { id: 450 }, contextFiles: files }).reason, 'duplicate')
})
test('retry preserves successful items and runs only failed/pending items', async () => {
  const batch = createImportBatch([{ name: 'a' }, { name: 'b' }, { name: 'c' }], null, 7)
  const calls = []
  await runImportBatch(batch, async item => { calls.push(item.name); if (item.name === 'b') throw Error('failure') })
  assert.equal(batch.completed, 2)
  await runImportBatch(batch, async item => calls.push(item.name))
  assert.equal(batch.completed, 3)
  assert.deepEqual(calls, ['a', 'b', 'c', 'b'])
})
test('cancel releases a hung operation, marks it uncertain and never replays it', async () => {
  const controller = new AbortController()
  const batch = createImportBatch([{ name: 'a' }, { name: 'b' }, { name: 'c' }], null, 7)
  const calls = []
  const running = runImportBatch(batch, async item => {
    calls.push(item.name)
    if (item.name === 'b') { controller.abort(); return new Promise(() => {}) }
  }, { signal: controller.signal })
  await running
  assert.equal(batch.running, false)
  assert.equal(batch.completed, 1)
  assert.equal(batch.items[1].state, 'uncertain')
  await runImportBatch(batch, async item => calls.push(item.name))
  assert.deepEqual(calls, ['a', 'b', 'c'])
})
test('timeout releases wait without processing later items or claiming completion', async () => {
  const batch = createImportBatch([{ name: 'a' }, { name: 'b' }], null, 7)
  await runImportBatch(batch, () => new Promise(() => {}), { timeoutMs: 5 })
  assert.equal(batch.completed, 0)
  assert.equal(batch.items[0].state, 'uncertain')
  assert.equal(batch.items[1].state, 'pending')
})
test('browser directory iterator drains repeated reader batches and preserves nested paths', async () => {
  const file = name => ({ name, isFile: true, file: resolve => resolve({ name, size: 1 }) })
  const dir = (name, groups) => ({ name, isDirectory: true, createReader() { let i = 0; return { readEntries: resolve => resolve(groups[i++] || []) } } })
  const result = []
  for await (const item of walkDropEntries([dir('root', [[file('a.txt')], [dir('nested', [[file('b.txt')]])]])])) result.push(item.relativePath)
  assert.deepEqual(result, ['root/a.txt', 'root/nested/b.txt'])
})
