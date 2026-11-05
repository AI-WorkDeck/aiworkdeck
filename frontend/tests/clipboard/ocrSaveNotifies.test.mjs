// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 教程问题 72（dev-board#1713）：截图取词的结果存进剪贴板历史后，剪贴板面板不刷新。
// insertClipboardAndCopy 只戳了 $refs.clipboardPanel（插件面板 / 别的坞位 / 别的实例都收不到），
// 要走和采集桥同一个出口 onClipboardSaved（它会广播 awd:clipboard-saved）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')

function extractMethod() {
  const start = SRC.indexOf('async insertClipboardAndCopy(text, options = {}) {')
  assert.ok(start > 0, '找不到 insertClipboardAndCopy')
  const open = SRC.indexOf(') {', start) + 2
  let depth = 0
  let i = open
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}' && --depth === 0) break
  }
  const body = SRC.slice(open + 1, i)
    .replace(/\/\/ #ifdef H5[\s\S]*?\/\/ #endif/, '')
    .replace(/\/\/ #ifndef H5/, '').replace(/\/\/ #endif/, '')
  // eslint-disable-next-line no-new-func
  return new Function('saveClipboardText', 'uni', `return async function (text, options = {}) {${body}}`)
}

test('72: OCR 结果入剪贴板历史后走 onClipboardSaved（广播 awd:clipboard-saved）', async () => {
  const saved = []
  const make = extractMethod()
  const fn = make(async (t) => ({ data: { id: 9, content: t } }), { setClipboardData() {} })
  const vm = { $refs: {}, onClipboardSaved: (item) => saved.push(item) }
  await fn.call(vm, ' 识别结果 ', { saveToHistory: true })
  assert.deepEqual(saved, [{ id: 9, content: '识别结果' }])
})
