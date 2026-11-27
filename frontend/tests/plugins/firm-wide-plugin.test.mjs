// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isGlobalPlugin, canOpenPluginWorkspace } from '../../src/utils/pluginViews.js'

// C18b：律所管理是全所工作台，欢迎页（无项目）也能打开；其他旧式插件仍要项目。
test('the firm plugin opens without a project; other legacy plugins still need one', () => {
  const lawfirm = { pluginId: 'lawfirm-management', views: [], hasDeclaredViews: false }
  const legacy = { pluginId: 'example-plugin', views: [], hasDeclaredViews: false }
  assert.equal(isGlobalPlugin(lawfirm), true)
  assert.equal(canOpenPluginWorkspace(lawfirm, false), true)
  assert.equal(isGlobalPlugin(legacy), false)
  assert.equal(canOpenPluginWorkspace(legacy, false), false)
  // A later manifest that declares its own views takes over from the host rule.
  const declared = { pluginId: 'lawfirm-management', hasDeclaredViews: true, views: [{ placement: 'workspace', scope: 'project' }], workspaceView: { scope: 'project' } }
  assert.equal(isGlobalPlugin(declared), false)
  assert.equal(canOpenPluginWorkspace(declared, false), false)
})

test('opening 律所管理 always uses the workspace tab, also from the welcome page', () => {
  const source = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const body = source.match(/\n    async handleOpenLawFirmPlugin\(opts = \{\}\) \{\n([\s\S]*?)\n    \},/)[1]
  assert.match(body, /this\.openPluginTab\('lawfirm-management'\)/)
  assert.doesNotMatch(body, /hasProject/)
})
