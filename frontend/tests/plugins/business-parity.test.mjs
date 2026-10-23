// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPluginBusinessServices } from '../../src/utils/pluginBusinessServices.js'
import { createSerialQueue } from '../../src/utils/asyncSerialize.js'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
function method(sfc, name, dependencies = {}) {
  const match = new RegExp(`\\n    (?:async )?${name}\\([^\\n]*\\) \\{`).exec(sfc)
  assert.ok(match, `${name} exists`)
  const end = sfc.indexOf('\n    },', match.index)
  return new Function(...Object.keys(dependencies), `return ({${sfc.slice(match.index, end + 6)}}).${name}`)(...Object.values(dependencies))
}
const panelSource = source('../../plugin-app/pages/panel.vue')
function panel(services) {
  const body = panelSource.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
  return new Function('window', 'BusinessPanel', body)({ awd: { services } }, {}).methods
}

test('cancelling a second litigation scope picker preserves the already selected volume', async () => {
  const picked = { label: '卷宗 A', description: '文件夹「卷宗 A」（folderId=5）' }
  const replies = [picked, null]
  const wrapper = panel({ request: async () => replies.shift() })
  let scope = null
  wrapper.selectScope(value => { scope = value })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(scope, picked)
  wrapper.selectScope(value => { scope = value })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(scope, picked, 'cancel must not silently widen the material scope to the entire project')
})

test('sensitive adapter preserves the original five minute processing window', async () => {
  const requests = []
  const previous = globalThis.window
  globalThis.window = { awd: { services: { request: async (...args) => { requests.push(args); return {} } } } }
  try {
    const api = await import('../../plugin-app/adapters/api.js')
    await api.previewSensitiveFile({ fileId: 1 })
    await api.desensitizeFile({ fileId: 1 })
    await api.restoreSensitiveFile({ fileId: 1 })
    assert.deepEqual(requests.map(args => [args[1], args[3].timeoutMs]), [
      ['preview', 300000], ['redact', 300000], ['restore', 300000],
    ])
  } finally { globalThis.window = previous }
})

test('sensitive import current reads the focused non-LOWA document through the real host wiring', async () => {
  const workbench = source('../../src/pages/project-overview/project-overview.vue')
  const plugin = source('../../src/components/PluginPane.vue')
  for (const fileType of ['pdf', 'txt', 'md', 'docx']) {
    const file = { id: 9, name: '合成材料.' + fileType, fileType, filePath: 'synthetic/' + fileType }
    const workspace = { focusedPane: 'right', activeFileLeft: { id: 8 }, activeFileRight: file, leftFiles: [{ id: 8 }],
      getPluginActiveEditor: () => null }
    workspace.handleDesensitizeActiveFile = method(workbench, 'handleDesensitizeActiveFile').bind(workspace)
    const actions = method(workbench, 'pluginBusinessActions').call(workspace)
    const dependencies = Object.fromEntries(['searchProjectContent', 'getProjectTags', 'getSensitiveOptions', 'previewSensitiveFile',
      'desensitizeFile', 'restoreSensitiveFile', 'getLitigationVisualStatus', 'getLitigationDiagrams', 'getLitigationKickoffPrompt',
      'restyleLitigationDiagram', 'packStatus', 'packInstall'].map(key => [key, async () => ({})]))
    Object.assign(dependencies, { createPluginBusinessServices,
      createPluginVoiceServices: () => ({}), createPluginCollectionServices: () => ({}), createPluginInsightServices: () => ({}),
      uni: { $emit() {} } })
    const host = { businessActions: actions, sessionGeneration: 1, projectId: 42, activeEditor: () => null,
      effectivePermissions: () => ['file_read', 'file_write'], listProjectFiles: async () => [file] }
    const service = method(plugin, 'businessServices', dependencies).call(host)
    assert.deepEqual(await service.request('sensitive', 'active'), file, `${fileType} remains importable without an editor executor`)
  }
})

test('cancelled litigation restyling releases the real drawing editor save barrier', async () => {
  const drawio = source('../../src/components/DrawioEditor.vue')
  const editor = { projectId: 42, file: { id: 5, parentId: 50 }, _persistQueue: createSerialQueue(), restylePending: false,
    persisted: [], boot: async () => { throw Error('cancelled redraw must not reload the drawing') },
    persistNow: async xml => { editor.persisted.push(xml) } }
  for (const name of ['matchesDiagram', 'onRestyling', 'onRestyled', 'persist']) editor[name] = method(drawio, name).bind(editor)
  let finishSave
  const saving = editor._persistQueue(() => new Promise(resolve => { finishSave = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  let current = true, currentProjectId = 42
  const events = [], redraws = []
  const service = createPluginBusinessServices({ projectId: () => currentProjectId, permissions: () => ['file_read', 'file_write'],
    isCurrent: () => current, api: { getLitigationDiagrams: async () => [{ folderId: 50, svgFileId: 6 }],
      restyleLitigationDiagram: async (...args) => { redraws.push(args) } },
    actions: { emit(name, value) { events.push([name, value]); if (name === 'awd:litviz-restyling') editor.onRestyling(value); else editor.onRestyled(value) } } })
  const result = service.request('litigation', 'restyle', { requestId: 'redraw', folderId: 50, mode: '白描', confirmOverwrite: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(editor.restylePending, true)
  current = false; currentProjectId = 99; service.dispose()
  finishSave(); await saving
  await assert.rejects(result, { code: 'cancelled' })
  assert.equal(editor.restylePending, false, 'leaving the plugin must resume normal drawing saves')
  assert.deepEqual(redraws, [])
  assert.equal(events.at(-1)[1].projectId, 42, 'completion belongs to the original project')
  assert.equal(events.at(-1)[1].failed, true)
  await editor.persist('<mxfile>new edit</mxfile>')
  assert.deepEqual(editor.persisted, ['<mxfile>new edit</mxfile>'])
})
