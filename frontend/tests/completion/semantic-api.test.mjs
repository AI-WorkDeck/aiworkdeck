// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
for (const name of ['getSemanticWritingSettings','saveSemanticWritingSettings','createSemanticWritingSuggestion','getSemanticWritingSuggestion','cancelSemanticWritingSuggestion','acceptSemanticWritingSuggestion']) {
  test(`${name} suppresses sensitive request and response body logging`, () => {
    const declaration = source.match(new RegExp(`export function ${name}\\([^]*?\\n}`))?.[0]
    assert.ok(declaration)
    const api = new Function('request', `return ${declaration.replace('export ', '')}`)(options => options)
    const options = api(1, { stance: '合成立场', documentText: '合成正文' }, { index: 0 })
    assert.equal(options.logBody, false)
  })
}

// office-tier1 O8：打开文档时的后台调用不弹账户/登录框；用户主动的改写/采用仍按原样提示
const fn = name => new Function('request', `return ${source.match(new RegExp(`export function ${name}\\([^]*?\\n}`))[0].replace('export ', '')}`)(o => o)
test('background writing calls never open the account prompt; explicit requests still may', () => {
  assert.equal(fn('getSemanticWritingSettings')(1).accountPrompt, false)
  assert.equal(fn('listWritingCompletions')(1).accountPrompt, false)
  assert.equal(fn('learnWritingCompletions')(1, { entries: [] }).accountPrompt, false)
  assert.equal(fn('createSemanticWritingSuggestion')(1, { mode: 'autocomplete' }).accountPrompt, false)
  assert.equal(fn('createSemanticWritingSuggestion')(1, { mode: 'rewrite' }).accountPrompt, undefined)
  assert.equal(fn('acceptSemanticWritingSuggestion')(1, 'id', {}).accountPrompt, undefined)
})
