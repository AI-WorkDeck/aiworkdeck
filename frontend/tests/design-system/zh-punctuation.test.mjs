// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// POLISH X29：中文标点守卫自身的回归测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compare } from '../../scripts/check-zh-punctuation.mjs'

test('baseline tolerates existing problems only, counting duplicates', () => {
  const { extra, fixed } = compare(['a', 'a', 'b'], ['a', 'c'])
  assert.deepEqual(extra, ['a', 'b'])
  assert.deepEqual(fixed, ['c'])
})

test('guard also scans desktop/main JSON, official plugin l10n and the Office add-in (Q, #1723)', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { collect } = await import('../../scripts/check-zh-punctuation.mjs')
  const repo = mkdtempSync(path.join(tmpdir(), 'zh-punct-'))
  const put = (rel, text) => { const f = path.join(repo, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text) }
  put('frontend/src/locales/zh-CN/a.js', "export default { ok: '正常的“引号”' }\n")
  put('frontend/src/locales/zh-TW/a.js', "export default { ok: '正常的「引號」' }\n")
  put('desktop/main/legal-notices.json', JSON.stringify({ trademark: { 'zh-CN': '「AI WorkDeck」为商标', 'en-US': '"AI WorkDeck" is a trademark' } }))
  put('desktop/main/zh-hant-table.json', JSON.stringify({ '「': '「' }))
  put('official-plugins/demo/l10n/zh-TW.json', JSON.stringify({ title: '確認?' }))
  put('office-addin/taskpane/locales/zh-CN.js', "export const ZH = { hint: '点「保存」' }\nexport default ZH\n")
  const hits = await collect(path.join(repo, 'frontend'))
  assert.deepEqual(hits.sort(), [
    'desktop/main/legal-notices.json trademark :: 「」 in zh-CN (use “ ”)',
    'office-addin/zh-CN.js hint :: 「」 in zh-CN (use “ ”)',
    'official-plugins/demo/l10n/zh-TW.json title :: half-width ? after Chinese',
  ])
})
