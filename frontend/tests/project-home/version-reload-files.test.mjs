// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#1470: the Explorer stays mounted while version operations change its files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/pages/project-overview/fileOpenTabs.js', import.meta.url), 'utf8')
const methods = new Function(source
  .replace(/^import .*$/gm, '')
  .replace('export const fileOpenTabsMethods = {', 'return {'))()

test('a version operation refreshes the retained Explorer even without affected editor IDs', async () => {
  for (const ids of [undefined, []]) {
    let refreshed = 0
    const vm = { $refs: { fileTree: { loadFiles() { refreshed++ } } } }
    await methods.onVersionReloadFiles.call(vm, ids)
    assert.equal(refreshed, 1)
  }
})

test('a pending Explorer refresh does not delay replacing stale open editor contents', async () => {
  const calls = []
  let finishTree
  const treeRequest = new Promise(resolve => { finishTree = resolve })
  const vm = {
    $refs: { fileTree: { loadFiles() { calls.push('tree'); return treeRequest } } },
    leftFiles: [{ id: 1, fileType: 'docx' }, { id: 2, fileType: 'txt' }],
    rightFiles: [{ id: 1, fileType: 'docx' }, { id: 3, fileType: 'docx' }],
    useLibreEditor: file => file.fileType === 'docx',
    async handleEditorReloadFile(file, options) { calls.push(['office', file.fileId, options]); return true },
    async reloadPlainTextInstances(id) { calls.push(['text', id]) },
  }
  const reloading = methods.onVersionReloadFiles.call(vm, [1, 2])
  await Promise.resolve()
  try {
    assert.deepEqual(calls.slice(0, 2), ['tree', ['office', 1, { forceActive: true, silentSuccessToast: false }]])
  } finally { finishTree() }
  await reloading
  assert.deepEqual(calls.slice(2), [['text', 1], ['text', 2]])
})

test('a collapsed Explorer does not prevent reloading affected text documents', async () => {
  const reloaded = []
  await methods.onVersionReloadFiles.call({
    $refs: {}, leftFiles: [], rightFiles: [],
    async reloadPlainTextInstances(id) { reloaded.push(id) },
  }, [2])
  assert.deepEqual(reloaded, [2])
})
