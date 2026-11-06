// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 提交弹窗「AI 写说明」：先保存文件再要建议，建议只填进输入框，失败不动律师已写的内容。
//   cd frontend && node --test tests/version-history/commitTitleSuggest.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../../src/components/version/WorkSessionBar.vue', import.meta.url), 'utf8')

function makeVm({ suggest, beforeCommit = null }) {
  const body = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>'))
    .replace(/^import[\s\S]*?from\s+'[^']+'\s*$/gm, '')
    .replace(/export default \{/, 'return {')
  const toasts = []
  globalThis.uni = { showToast: t => toasts.push(t.title) }
  const ends = []
  const options = new Function('endWorkSession', 'discardWorkSession', 'suggestSessionTitle', 'switchToMainline', 'adoptDraft', 'abandonDraft', body)(
    async (...args) => { ends.push(args); return { data: {} } }, () => {}, suggest, () => {}, () => {}, () => {})
  const vm = Object.assign({ projectId: 7, beforeCommit, $t: k => k, $emit() {} }, options.data())
  for (const [k, fn] of Object.entries(options.methods)) vm[k] = fn.bind(vm)
  return { vm, toasts, ends }
}

test('先保存再要建议，建议填进输入框', async () => {
  const order = []
  const { vm } = makeVm({
    beforeCommit: async () => { order.push('save') },
    suggest: async id => { order.push(`suggest:${id}`); return { data: { title: '补充付款条款' } } },
  })
  vm.openNaming()
  await vm.suggestTitle()
  assert.deepEqual(order, ['save', 'suggest:7'])
  assert.equal(vm.title, '补充付款条款')
  assert.equal(vm.suggesting, false)
})

test('保存被拦下就不调用模型；失败提示且保留已写内容', async () => {
  let calls = 0
  const blocked = makeVm({ beforeCommit: async () => false, suggest: async () => { calls++ } })
  blocked.vm.openNaming()
  await blocked.vm.suggestTitle()
  assert.equal(calls, 0)

  const failing = makeVm({ suggest: async () => { throw new Error('暂时没能生成说明，请手动填写') } })
  failing.vm.openNaming()
  failing.vm.title = '我自己写的'
  await failing.vm.suggestTitle()
  assert.equal(failing.vm.title, '我自己写的')
  assert.deepEqual(failing.toasts, ['暂时没能生成说明，请手动填写'])
})

test('生成中不能提交，避免提交成空标题后建议才回来', async () => {
  let release
  const { vm, ends } = makeVm({ suggest: () => new Promise(r => { release = r }) })
  vm.openNaming()
  const pending = vm.suggestTitle()
  await vm.end()
  assert.equal(ends.length, 0)
  release({ data: { title: '下调违约金比例' } })
  await pending
  await vm.end()
  assert.deepEqual(ends[0], [7, '下调违约金比例'])
})
