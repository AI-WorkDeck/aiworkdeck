// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 中文标点守卫（POLISH X29，CEO 11-24 裁定）：
// - zh-CN / zh-TW：中文后面用全角 ？ ：，不用半角 ? :；中文句子里不用直引号 "…"；
// - zh-CN 用大陆引号 “ ”（嵌套 ‘ ’），不用「」；zh-TW 用「」，不用 “ ”。
// 存量问题记在 scripts/zh-punctuation-baseline.json（只许减少），新增文案照常拦。
// 用法：node scripts/check-zh-punctuation.mjs [--write-baseline]
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const CJK = '\\u3400-\\u9fff\\uf900-\\ufaff'
const COMMON = [
  ['half-width ? after Chinese', new RegExp(`[${CJK}]\\?`)],
  ['half-width : after Chinese', new RegExp(`[${CJK}]:(?!//)`)],
  ['straight double quote in Chinese text', new RegExp(`"[^"]*[${CJK}][^"]*"`)],
]
const RULES = {
  'zh-CN': [...COMMON, ['「」 in zh-CN (use “ ”)', /[「」]/]],
  'zh-TW': [...COMMON, ['“ ” in zh-TW (use 「」)', /[“”]/]],
}

function* strings(obj, prefix = '') {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') yield [key, v]
    else if (v && typeof v === 'object') yield* strings(v, key)
  }
}

export async function collect(root = process.cwd()) {
  const hits = []
  for (const [locale, rules] of Object.entries(RULES)) {
    const dir = path.resolve(root, 'src/locales', locale)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
      const mod = await import(pathToFileURL(path.join(dir, file)).href)
      for (const [key, value] of strings(mod.default)) {
        for (const [name, re] of rules) if (re.test(value)) hits.push(`${locale}/${file} ${key} :: ${name}`)
      }
    }
  }
  return hits
}

export function compare(hits, baseline) {
  const left = new Map()
  for (const b of baseline) left.set(b, (left.get(b) || 0) + 1)
  const extra = []
  for (const h of hits) {
    const n = left.get(h) || 0
    if (n > 0) left.set(h, n - 1)
    else extra.push(h)
  }
  return { extra, fixed: [...left].filter(([, n]) => n > 0).map(([h]) => h) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const baselinePath = path.resolve(process.cwd(), 'scripts/zh-punctuation-baseline.json')
  const hits = await collect()
  if (process.argv.includes('--write-baseline')) {
    writeFileSync(baselinePath, JSON.stringify(hits, null, 1) + '\n')
    console.log(`baseline written: ${hits.length} entries`)
    process.exit(0)
  }
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : []
  const { extra, fixed } = compare(hits, baseline)
  if (fixed.length) console.log(`zh-punctuation: ${fixed.length} baseline entries are fixed; run with --write-baseline to shrink the baseline`)
  if (extra.length) {
    for (const e of extra) console.error('✗ ' + e)
    console.error(`check-zh-punctuation: ${extra.length} new punctuation problems (zh-CN “ ”, zh-TW 「」, full-width ？ ：)`)
    process.exit(1)
  }
  console.log(`✓ check-zh-punctuation: no new problems (${hits.length} existing in baseline)`)
}
