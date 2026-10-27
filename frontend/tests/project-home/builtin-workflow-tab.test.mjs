// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { builtinWorkflowTabMethods } from '../../src/pages/project-overview/builtinWorkflowTab.js'
import { isContextEligibleTab } from '../../src/pages/project-overview/activeTabContext.js'

test('workflow rules open once, refocus across panes and update the requested version', () => {
  const vm = { leftFiles: [], rightFiles: [], splitMode: true, focusedPane: 'right', $t: x => x, $nextTick: f => f(), triggerWorkbenchResize() {} }
  Object.assign(vm, builtinWorkflowTabMethods)
  vm.openWorkflowEditorTab({ workflowId: 'contract-review', versionId: '__new__' })
  const tab = vm.rightFiles[0]
  assert.equal(vm.activeFileIdRight, tab.id)
  assert.equal(isContextEligibleTab(tab), false)
  assert.equal(isContextEligibleTab({ ...tab, id: 7 }), false)
  vm.splitMode = false
  vm.focusedPane = 'left'
  vm.openWorkflowEditorTab({ workflowId: 'file-organization', versionId: 'default' })
  assert.equal(vm.focusedPane, 'right')
  assert.equal(vm.splitMode, true)
  assert.equal(vm.leftFiles.length + vm.rightFiles.length, 1)
  assert.deepEqual(tab.workflowRequest, { workflowId: 'file-organization', versionId: 'default' })
})
