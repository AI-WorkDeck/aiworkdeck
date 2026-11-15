// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 插件权限的展示名：后端 PluginService.KNOWN_PERMISSIONS 认的每一个权限，三处市场界面（列表、详情、
// 侧栏安装弹窗）都要有各语种名称，不能把原始键（worklog_read）直接给律师看（0.86 RC 走查发现）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const read = (p) => readFileSync(root + p, 'utf8')
const javaSet = read('backend/src/main/java/com/checkba/service/ai/PluginService.java').match(/KNOWN_PERMISSIONS\s*=\s*Set\.of\(([^)]*)\)/)
assert.ok(javaSet, 'KNOWN_PERMISSIONS not found in PluginService.java')
const KNOWN = [...javaSet[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])
const PANES = ['MarketPane.vue', 'MarketDetailPane.vue', 'MarketSidebarPanel.vue']

// 每处界面：权限 → market.* 词条键（两种写法：getter 表、内联 labels 对象）
function labelsIn(file) {
  const src = read('frontend/src/components/' + file)
  const out = {}
  for (const m of src.matchAll(/get ([a-z_]+)\(\) \{ return t\('market\.(perm[A-Za-z]+)'\) \}/g)) out[m[1]] = m[2]
  const inline = src.match(/const labels = \{([^}]*)\}/)
  if (inline) for (const m of inline[1].matchAll(/([a-z_]+): '(perm[A-Za-z]+)'/g)) out[m[1]] = m[2]
  return out
}

for (const file of PANES) {
  test(`${file}: every KNOWN_PERMISSION has a label`, () => {
    const labels = labelsIn(file)
    const missing = KNOWN.filter((p) => !labels[p])
    assert.deepEqual(missing, [], `${file} shows raw permission keys for: ${missing.join(', ')}`)
  })
}

test('every label key exists in every locale', async () => {
  const keys = new Set(PANES.flatMap((f) => KNOWN.map((p) => labelsIn(f)[p]).filter(Boolean)))
  const locales = readdirSync(root + 'frontend/src/locales', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  assert.ok(locales.length >= 20)
  for (const loc of locales) {
    const market = (await import(root + `frontend/src/locales/${loc}/market.js`)).default
    for (const k of keys) assert.ok(market[k], `${loc}/market.js lacks ${k}`)
  }
})
