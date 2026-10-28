// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isPluginUpdateAvailable } from '../../src/utils/marketUpdates.js'
const source = readFileSync(new URL('../../src/components/MarketSidebarPanel.vue', import.meta.url), 'utf8')
const start = source.indexOf('    installedRows() {') + '    installedRows() {'.length
const end = source.indexOf('\n    },', start)
const compute = new Function('isPluginUpdateAvailable', `return function(isPanelSkill, isVoiceGroupMember, ICONS, CATEGORY_GLYPHS, ACTIVATION_STATE) {${source.slice(start, end)}}`)(isPluginUpdateAvailable)
test('voice has only one plugin switch; AI skills stay separate after uninstall too', () => {
  for (const plugins of [[{ id: 'voice', name: 'Voice', enabled: false }], []]) {
    const rows = compute.call({ plugins, skills: [{ id: 'text-to-speech', enabled: true }, { id: 'meeting-recorder', enabled: true }], searchText: '', $t: value => value }, () => true, id => ['text-to-speech', 'meeting-recorder'].includes(id), {}, {}, {})
    assert.equal(rows.filter(row => row.kind === 'plugin' || row.panel).length, plugins.length)
    assert.equal(rows.filter(row => row.kind === 'skill' && !row.panel).length, 2)
    assert.equal(rows.some(row => row.group), false)
  }
})

test('builtinWorkflow skills are hidden from installedRows in lazy mode', () => {
  const rows = compute.call(
    {
      plugins: [],
      skills: [
        { id: 'contract-review', name: '合同审查', enabled: true, builtinWorkflow: true },
        { id: 'evidence-linked-report', name: '证据整理与核查闭环', enabled: true, builtinWorkflow: true },
        { id: 'custom-skill', name: 'Custom Skill', enabled: true, builtinWorkflow: false },
      ],
      searchText: '',
      $t: value => value,
    },
    () => false,
    () => false,
    {},
    {},
    {},
  )
  assert.deepEqual(rows.map(r => r.id), ['custom-skill'])
})

test('ChatInterface builtin workflows fold like Jev with Advanced settings, more button, right-click menu, and workspace version manager', () => {
  const chatSource = readFileSync(new URL('../../src/components/ChatInterface.vue', import.meta.url), 'utf8')
  assert.ok(chatSource.includes('<details class="builtin-workflows-fold"'))
  assert.ok(chatSource.includes('builtin-workflows-summary'))
  assert.ok(chatSource.includes('builtin-workflows-adv-btn'))
  assert.ok(chatSource.includes('builtin-workflow-more-btn'))
  assert.ok(chatSource.includes('@contextmenu.prevent.stop="openBuiltinWorkflowContextMenu($event, bw)"'))
  assert.ok(chatSource.includes('bw-context-menu'))
  const editorSource = readFileSync(new URL('../../src/components/BuiltinWorkflowEditor.vue', import.meta.url), 'utf8')
  assert.ok(chatSource.includes('openWorkflowEditorTab'))
  assert.ok(chatSource.includes('data-bw-actions'))
  assert.ok(editorSource.includes('bw-editor-dialog'))
  assert.ok(editorSource.includes('bw-workflow-tabs'))
  assert.ok(editorSource.includes('is-new-draft'))
  assert.ok(editorSource.includes('.awd-btn-primary'))
  assert.ok(editorSource.includes('.awd-btn-secondary'))
  assert.ok(editorSource.includes('submitBuiltinWorkflowVersion'))
  const adminSource = readFileSync(new URL('../../src/components/admin/AdminPane.vue', import.meta.url), 'utf8')
  assert.ok(adminSource.includes("key: 'workflows'"))
  assert.ok(adminSource.includes('<BuiltinWorkflowEditor'))
})
