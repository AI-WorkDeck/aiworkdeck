// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reactive, computed, watch, nextTick } from 'vue'
const source = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
function method(name) {
  const body = source.match(new RegExp(`    ${name}\\(\\) \\{([\\s\\S]*?)\\n    \\},`))[1]
  return new Function(body)
}
const findDocument = method('insightDocFile')
const available = method('documentAvailablePlugins')
const watcher = new Function('id', source.match(/insightDocFileId: \{[\s\S]*?handler\(id\) \{([\s\S]*?)\n      \},/)[1])
const writer = { id: 1, fileType: 'docx' }
const defaults = () => ({ isChatMode: false, chatCanvasVisible: false, splitMode: false, focusedPane: 'left', activeFileLeft: writer, activeFileRight: null, isInsightDoc: f => f?.fileType === 'docx' })
test('evidence follows visible Writer; hidden canvas/split and non-Writer formats do not expose it', () => {
  for (const fileType of ['docx', 'pptx', 'xlsx', 'pdf']) {
    const vm = { ...defaults(), activeFileLeft: { id: 1, fileType } }
    assert.equal(findDocument.call(vm)?.id || null, fileType === 'docx' ? 1 : null)
  }
  assert.equal(findDocument.call({ ...defaults(), isChatMode: true }), null)
  assert.equal(findDocument.call({ ...defaults(), isChatMode: true, chatCanvasVisible: true }), writer)
  assert.equal(findDocument.call({ ...defaults(), activeFileLeft: null, activeFileRight: writer }), null)
  assert.equal(findDocument.call({ ...defaults(), activeFileLeft: null, activeFileRight: writer, splitMode: true }), writer)
})
test('closing document reactively removes evidence entry and restores AI without changing other plugins', async () => {
  const vm = reactive({ ...defaults(), rightPaneKey: 'plugin-insight', leftPaneKey: 'plugin-insight', dynamicPlugins: [{ pluginId: 'insight' }, { pluginId: 'voice' }] })
  const doc = computed(() => findDocument.call(vm))
  Object.defineProperty(vm, 'insightDocFileId', { get: () => doc.value?.id || null })
  const stop = watch(() => vm.insightDocFileId, id => watcher.call(vm, id))
  assert.equal(available.call(vm).length, 2)
  vm.activeFileLeft = null
  await nextTick()
  assert.deepEqual(available.call(vm).map(p => p.pluginId), ['voice'])
  assert.equal(vm.rightPaneKey, 'ai')
  assert.equal(vm.leftPaneKey, 'files')
  stop()
})
