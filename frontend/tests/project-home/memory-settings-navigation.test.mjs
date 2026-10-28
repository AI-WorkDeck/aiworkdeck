// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'

const host = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const chat = readFileSync(new URL('../../src/components/ChatInterface.vue', import.meta.url), 'utf8')
const script = host.match(/<script>([\s\S]*?)<\/script>/)[1]
const options = parse(script, { sourceType: 'module' }).program.body.find(n => n.type === 'ExportDefaultDeclaration').declaration
const methods = options.properties.find(n => n.key?.name === 'methods').value.properties
function method(name) {
  const node = methods.find(n => n.key?.name === name)
  return new Function(`return ({${script.slice(node.start, node.end)}}).${name}`)()
}
const openSettings = method('openSettingsTab')
const openMarket = method('goToPluginMarket')
function workbench(overrides = {}) {
  return {
    isChatMode: true, chatCanvasOpen: false,
    leftFiles: [{ id: 'document' }], rightFiles: [],
    activeFileIdLeft: 'document', activeFileIdRight: null,
    splitMode: false, focusedPane: 'left',
    $t: key => key, $nextTick: fn => fn(), triggerWorkbenchResize() {},
    ...overrides,
  }
}

test('memory opens a visible settings tab without replacing the document', () => {
  const vm = workbench()
  openSettings.call(vm, { nav: 'memory' })
  assert.equal(vm.chatCanvasOpen, true)
  assert.equal(vm.activeFileIdLeft, 'admin-settings')
  assert.deepEqual(vm.leftFiles.map(f => f.id), ['document', 'admin-settings'])
  assert.equal(vm.leftFiles[1].adminNav, 'memory')
})

test('settings reuse an existing right-pane tab and retarget it on repeated requests', () => {
  const settings = { id: 'admin-settings', adminNav: 'team' }
  const vm = workbench({ splitMode: true, rightFiles: [settings] })
  openSettings.call(vm, { nav: 'memory' })
  openSettings.call(vm, { nav: 'memory' })
  assert.equal(vm.rightFiles.length, 1)
  assert.equal(vm.rightFiles[0], settings)
  assert.equal(settings.adminNav, 'memory')
  assert.equal(vm.focusedPane, 'right')
  assert.equal(vm.activeFileIdRight, 'admin-settings')
  assert.equal(vm.activeFileIdLeft, 'document')
})

test('skills reveal the workbench market and repeated entry keeps it open', async () => {
  const calls = []
  const vm = workbench({
    leftPaneKey: 'files', sidebarCollapsed: false,
    async switchViewMode(mode) { calls.push(mode); this.isChatMode = false },
    toggleLeftPane(key) { calls.push(key); this.leftPaneKey = key; this.sidebarCollapsed = false },
  })
  await openMarket.call(vm)
  await openMarket.call(vm)
  assert.deepEqual(calls, ['ide', 'market'])
  assert.equal(vm.activeFileIdLeft, 'document')
  vm.sidebarCollapsed = true
  await openMarket.call(vm)
  assert.deepEqual(calls, ['ide', 'market', 'market'])
  assert.equal(vm.sidebarCollapsed, false)
})

test('chat delegates management navigation to its host without a memory overlay', () => {
  assert.match(chat, /\$emit\('open-settings', \{ nav: 'memory' \}\)/)
  assert.match(chat, /emit\('manage-skills'\)/)
  assert.doesNotMatch(chat, /showMemoryBrowser|<MemoryBrowser|pages\/plugin-market\/plugin-market/)
  assert.match(host, /@open-settings="openSettingsTab"/)
  assert.match(host, /@manage-skills="goToPluginMarket"/)
})
