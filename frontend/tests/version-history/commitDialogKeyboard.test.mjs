// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 教程问题 93（dev-board#1713）：提交弹窗打开后输入框没有焦点，还得再点一下才能打字，
// 回车也不能提交。修法：输入框随弹窗挂载即聚焦；回车提交，输入法选词的回车不算。
//   cd frontend && node --test tests/version-history/commitDialogKeyboard.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../../src/components/version/WorkSessionBar.vue', import.meta.url), 'utf8')

function makeVm() {
  const body = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>'))
    .replace(/^import[\s\S]*?from\s+'[^']+'\s*$/gm, '')
    .replace(/export default \{/, 'return {')
  const options = new Function('endWorkSession', 'discardWorkSession', 'switchToMainline', 'adoptDraft', 'abandonDraft', body)(
    () => {}, () => {}, () => {}, () => {}, () => {})
  const vm = Object.assign({}, options.data())
  for (const [k, fn] of Object.entries(options.methods)) vm[k] = fn.bind(vm)
  vm.ends = 0
  vm.end = () => { vm.ends++ }
  return vm
}

test('提交弹窗的输入框打开即聚焦，并监听回车', () => {
  const input = source.slice(source.indexOf('v-model="title"'), source.indexOf('/>', source.indexOf('v-model="title"')))
  assert.match(input, /:focus="true"/)
  assert.match(input, /@keydown\.enter="onTitleEnter"/)
})

test('回车提交；输入法选词时的回车不提交', () => {
  const vm = makeVm()
  vm.onTitleEnter({ key: 'Enter', isComposing: true, keyCode: 229 })
  vm.onTitleEnter({ key: 'Enter', keyCode: 229 })
  assert.equal(vm.ends, 0)
  let prevented = false
  vm.onTitleEnter({ key: 'Enter', keyCode: 13, preventDefault() { prevented = true } })
  assert.equal(vm.ends, 1)
  assert.equal(prevented, true)
})
