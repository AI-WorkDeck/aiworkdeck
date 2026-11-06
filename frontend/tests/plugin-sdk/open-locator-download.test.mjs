// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 表格化审阅插件需要的两处桥补齐：ui.openFile 可带 locator、files.download 导出办公文件。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>'))
  .replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+default/, 'return')
const files = [{ id: 7, name: '合同', isFolder: true }, { id: 42, parentId: 7, name: '租赁合同.docx', fileType: 'docx' }]

function harness(permissions) {
  const events = [], downloads = []
  const uni = { $on() {}, $off() {}, $emit: (...args) => events.push(args) }
  const options = new Function('getProjectFiles', 'uni', 'window', 'getAppLanguage', body)(
    async () => files, uni, { addEventListener() {}, removeEventListener() {} }, () => 'zh-CN')
  const vm = { ...options.data(), projectId: 5, pluginId: 'tabular-review', permissions, $refs: {}, $emit() {} }
  for (const [key, fn] of Object.entries(options.methods)) vm[key] = fn.bind(vm)
  for (const [key, fn] of Object.entries(options.computed)) Object.defineProperty(vm, key, { get: fn.bind(vm) })
  vm.triggerDownload = args => downloads.push(args)
  return { vm, events, downloads }
}

test('ui.openFile 透传清洗后的 docx/pdf 定位符，其余字段与非法类型丢弃', async () => {
  const h = harness(['file_read'])
  const path = '合同/租赁合同.docx'
  await h.vm.handleCall('ui.openFile', { path, locator: { type: 'docx', quote: '  租期\n自 2026 年  ', bookmark: 'x', fileId: 99 } })
  await h.vm.handleCall('ui.openFile', { path, locator: { type: 'pdf', page: 3, quote: 'a'.repeat(900) } })
  await h.vm.handleCall('ui.openFile', { path, locator: { type: 'web', url: 'https://evil' } })
  await h.vm.handleCall('ui.openFile', { path, locator: { type: 'pdf', page: -1 } })
  await h.vm.handleCall('ui.openFile', { path })
  const locators = h.events.filter(e => e[0] === 'awd:open-evidence-target').map(e => e[1].locator)
  assert.deepEqual(locators[0], { type: 'docx', quote: '租期 自 2026 年' })
  assert.equal(locators[1].page, 3)
  assert.equal(locators[1].quote.length, 500)
  assert.deepEqual(locators.slice(2), [null, null, null])
  assert.ok(h.events.every(e => e[0] !== 'awd:open-evidence-target' || e[1].fileId === 42))
})

test('files.download 需 file_write，只认办公扩展名，MIME 由宿主决定', async () => {
  const denied = harness(['file_read'])
  assert.equal((await denied.vm.handleCall('files.download', { name: 'a.xlsx', data: new ArrayBuffer(1) })).error.code, 'permission_denied')
  assert.equal(denied.downloads.length, 0)

  const h = harness(['file_write'])
  const ok = await h.vm.handleCall('files.download', { name: '../审阅表<1>.xlsx', data: new Uint8Array([80, 75]), type: 'text/html' })
  assert.equal(ok.ok, true)
  assert.equal(h.downloads[0].name, '_审阅表_1_.xlsx')
  assert.equal(h.downloads[0].type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  for (const name of ['a.html', 'a.exe', '.xlsx', '']) {
    assert.equal((await h.vm.handleCall('files.download', { name, data: new ArrayBuffer(1) })).error.code, 'invalid_params')
  }
  assert.equal((await h.vm.handleCall('files.download', { name: 'a.csv', data: 'text' })).error.code, 'invalid_params')
  assert.equal((await h.vm.handleCall('files.download', { name: 'a.docx', data: new ArrayBuffer(20 * 1024 * 1024 + 1) })).error.code, 'quota_exceeded')
  assert.equal(h.downloads.length, 1)
})
