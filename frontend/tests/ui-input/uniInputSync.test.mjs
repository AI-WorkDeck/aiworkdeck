// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// UI-INPUT1：uni-app H5 输入框的 v-model 回写节流 100 ms，确认按钮在这期间读到旧值（稿名只剩第一个字）。
// 构建时把节流换成同步回写；这里对装着的那份 uni-h5 源码真跑一遍补丁，并用补丁后的同一段逻辑验行为。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { patchUniInputSync } from '../../scripts/uni-input-sync.mjs'

const require = createRequire(import.meta.url)
const file = require.resolve('@dcloudio/uni-h5/dist/uni-h5.es.js')
const source = readFileSync(file, 'utf8')

test('装着的 uni-h5 里那段节流还在，补丁能打上，打完不再节流', () => {
  const patched = patchUniInputSync(source)
  assert.notEqual(patched, source)
  assert.match(patched, /AI WorkDeck \(scripts\/uni-input-sync\.mjs\)/)
  assert.doesNotMatch(patched.slice(patched.indexOf('function useValueSync'), patched.indexOf('function useAutoFocus')), /throttle\(/)
})

test('锚点对不上（uni-app 改了这段）时构建失败，而不是悄悄不修', () => {
  assert.throws(() => patchUniInputSync('export const nothing = 1'), /anchor not found/)
})

test('补丁后的回写：一阵快速输入里每一下都立刻回写，确认时读到的是整串', () => {
  // 取补丁后的 useValueSync 原样执行（watch/debounce 用最小替身），模拟一阵 5 下的快速输入后立刻读 v-model
  const patched = patchUniInputSync(source)
  const body = patched.slice(patched.indexOf('function useValueSync'), patched.indexOf('function useAutoFocus'))
  const debounce = (fn) => Object.assign(fn, { cancel() {} })
  const throttle = () => { throw new Error('throttle must not be used') }
  const make = new Function('debounce', 'throttle', 'watch', 'onBeforeMount', 'getValueString', body + '\nreturn useValueSync')
  const useValueSync = make(debounce, throttle, () => {}, () => {}, (v) => String(v))
  let model = ''
  const emit = (name, v) => { if (name === 'update:modelValue') model = v }
  const { triggerInput } = useValueSync({ type: 'text' }, { value: '' }, emit, () => {})
  for (const v of ['R', 'RC', 'RC ', 'RC 冲', 'RC 冲突方案C']) triggerInput({}, { value: v })
  assert.equal(model, 'RC 冲突方案C')
})
