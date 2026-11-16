// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 插件工具权限升级的重新授权提示：每条变更都点名工具并说清改了什么；批准带回 toolApprovalToken；取消不提交。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import en from '../../src/locales/en-US/market.js'

const source = readFileSync(new URL('../../src/utils/pluginToolApproval.js', import.meta.url), 'utf8')
const body = source.replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+(async\s+)?function/g, '$1function')
  + '\nreturn { describeToolChange, pendingToolChanges, promptToolApproval }'
const t = (key, params = {}) => String(en[key.replace(/^market\./, '')] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k])
function load(confirm) {
  const approvals = [], modals = []
  const uni = { showModal: o => { modals.push(o); o.success({ confirm }) } }
  const api = (...args) => { approvals.push(args); return Promise.resolve() }
  return { mod: new Function('t', 'approvePluginToolChanges', 'uni', body)(t, api, uni), approvals, modals }
}
const plugin = {
  id: 'demo', name: 'Demo', toolApprovalToken: 'tok-1',
  pendingToolChanges: [
    { name: 'demo_add', label: 'demo_add', kind: 'tool', reasons: ['access', 'confirm'], before: { access: 'read' }, after: { access: 'destructive' } },
    { name: 'mcp_x', label: 'research/lookup', kind: 'mcp', reasons: ['mcp'], before: {}, after: {} },
    { name: 'demo_new', label: 'demo_new', kind: 'tool', reasons: ['new', 'handler', 'schema'], before: null, after: { access: 'write' } }
  ]
}

test('each change names the tool and what changed', () => {
  const { mod } = load(true)
  assert.equal(mod.describeToolChange(plugin.pendingToolChanges[0]), 'demo_add: access read-only → can delete data, no longer asks you to confirm first')
  assert.match(mod.describeToolChange(plugin.pendingToolChanges[1]), /^research\/lookup: now connects to a different MCP server/)
  assert.match(mod.describeToolChange(plugin.pendingToolChanges[2]), /new tool \(can modify data\).*different operation.*inputs changed/)
})
test('approving submits the token that was shown', async () => {
  const { mod, approvals, modals } = load(true)
  assert.equal(await mod.promptToolApproval(plugin, 'Demo'), true)
  assert.deepEqual(approvals, [['demo', 'tok-1']])
  assert.match(modals[0].content, /Demo/); assert.match(modals[0].content, /demo_add/)
})
test('declining or nothing pending submits nothing', async () => {
  const declined = load(false)
  assert.equal(await declined.mod.promptToolApproval(plugin), false)
  assert.equal(declined.approvals.length, 0)
  const none = load(true)
  assert.equal(await none.mod.promptToolApproval({ id: 'demo', pendingToolChanges: [] }), false)
  assert.equal(none.modals.length, 0)
})
