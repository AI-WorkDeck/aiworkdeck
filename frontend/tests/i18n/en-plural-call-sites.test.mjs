// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 英文 QA 2026-11-14 第 5 条（「1 files」）：英文词条写成 'x file | x files' 后，调用处必须把数量作为
// 第三个参数传给 $t / t（vue-i18n 只在有 plural 参数时选形），漏传就会原样显示「x file | x files」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../../src/', import.meta.url).pathname
const EN = join(SRC, 'locales/en-US')
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (n === 'locales' || n === 'node_modules') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|js|mjs)$/.test(n)) out.push(p)
  }
  return out
}

test('every English singular|plural message is called with a plural count', async () => {
  const pluralKeys = []
  for (const f of readdirSync(EN).filter(f => f.endsWith('.js'))) {
    const ns = f.replace(/\.js$/, '')
    const mod = (await import(join(EN, f))).default
    for (const [k, v] of Object.entries(mod)) if (typeof v === 'string' && /\{(count|n)\}[^|]* \| [^|]*\{(count|n)\}/.test(v)) pluralKeys.push(ns + '.' + k)
  }
  assert.ok(pluralKeys.length >= 5, 'expected the file-count plurals: ' + pluralKeys)
  const files = walk(SRC).map(p => [p, readFileSync(p, 'utf8')])
  for (const key of pluralKeys) {
    let calls = 0
    for (const [p, src] of files) {
      for (const m of src.matchAll(new RegExp("\\b(?:\\$t|t|tr|_t)\\(\\s*'" + key.replace('.', '\\.') + "'", 'g'))) {
        calls++
        // 取到这次调用的右括号为止，数顶层逗号：至少两个（key, params, plural）
        let depth = 0, commas = 0, i = m.index + m[0].indexOf('(')
        for (; i < src.length; i++) {
          const c = src[i]
          if ('({['.includes(c)) depth++
          else if (')}]'.includes(c)) { depth--; if (depth === 0) break }
          else if (c === ',' && depth === 1) commas++
        }
        assert.ok(commas >= 2, `${key} at ${p.slice(SRC.length)} must pass the count as the plural argument`)
      }
    }
    assert.ok(calls > 0, key + ' has no call site')
  }
})
