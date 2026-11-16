// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 版本文本对比（xlsx/pptx 等走 DocDiffViewer）遇到带打开密码的文件：后端回 kind=DOC_ENCRYPTED，
// 界面显示本地化的明确原因，而不是后端的通用「版本记录操作失败，请重试」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/DocDiffViewer.vue', import.meta.url), 'utf8')
const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>'))
  .replace(/^import .*$/gm, '').replace('export default', 'return')

function viewerWith(fail) {
  const getVersionFileText = async () => { throw fail }
  const component = new Function('markRaw', 'getVersionFileText', script)(v => v, getVersionFileText)
  const vm = {
    ...component.methods,
    $t: key => key,
    versionSpec: { projectId: 1, path: '台账.xlsx', oldRef: 'a^', newRef: 'a' },
    loading: false, error: null,
  }
  const origError = console.error
  console.error = () => {}
  return vm.loadDocuments().then(() => { console.error = origError; return vm })
}

test('带打开密码：显示本地化的密码说明', async () => {
  const vm = await viewerWith(Object.assign(new Error('版本记录操作失败，请重试'), { code: 1, kind: 'DOC_ENCRYPTED' }))
  assert.equal(vm.error, 'version.officePasswordProtected')
  assert.equal(vm.loading, false)
})

test('其他失败：仍显示后端给的文案', async () => {
  const vm = await viewerWith(Object.assign(new Error('这一版里没有这份文件'), { code: 1 }))
  assert.equal(vm.error, '这一版里没有这份文件')
})
