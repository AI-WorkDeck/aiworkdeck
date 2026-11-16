// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 三方合并右栏三栏的字符级标注（台账 B13）
import test from 'node:test'
import assert from 'node:assert/strict'
import { charDiff } from '../../src/utils/textDiff.js'

const join = (segs, types) => segs.filter((s) => types.includes(s.type)).map((s) => s.text).join('')

test('标出相对共同的上一版改了的那几个字', () => {
  const segs = charDiff('乙方应于协议生效后 10 个工作日内付清。', '乙方应于协议生效后 15 个工作日内付清（方案C）。')
  assert.equal(join(segs, ['same', 'del']), '乙方应于协议生效后 10 个工作日内付清。')
  assert.equal(join(segs, ['same', 'ins']), '乙方应于协议生效后 15 个工作日内付清（方案C）。')
  const changed = segs.filter((s) => s.type !== 'same')
  assert.ok(changed.some((s) => s.type === 'del' && s.text.includes('0')), JSON.stringify(segs))
  assert.ok(changed.some((s) => s.type === 'ins' && s.text.includes('5')), JSON.stringify(segs))
  assert.ok(segs.some((s) => s.type === 'same' && s.text.startsWith('乙方应于协议生效后 1')), 'the unchanged lead stays unmarked')
})

test('没改就整段原样；空串两边都空', () => {
  assert.deepEqual(charDiff('第一条。', '第一条。'), [{ type: 'same', text: '第一条。' }])
  assert.deepEqual(charDiff('', ''), [])
  assert.deepEqual(charDiff('', '新增'), [{ type: 'ins', text: '新增' }])
  assert.deepEqual(charDiff('删掉', ''), [{ type: 'del', text: '删掉' }])
})

test('超长段落不算 LCS，整段标成删旧加新（不卡界面）', () => {
  const a = 'x'.repeat(3000) + 'a', b = 'y'.repeat(3000) + 'b'
  const segs = charDiff(a, b)
  assert.equal(join(segs, ['same', 'del']), a)
  assert.equal(join(segs, ['same', 'ins']), b)
})
