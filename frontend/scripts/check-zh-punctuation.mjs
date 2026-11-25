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

function check(locale, label, key, value, hits) {
  for (const [name, re] of RULES[locale]) if (re.test(value)) hits.push(`${label} ${key} :: ${name}`)
}

// 前端 locale 之外，带中文文案的地方也要守（Q 在 #1723 修过 desktop 的 legal-notices.json 漏网）：
// 桌面主进程 JSON（叶子键是 locale 码）、官方插件 l10n、Office 加载项 locales。
// zh-hant-table.json 是转换字表，不是界面文案，不扫。
function* leavesByLocale(obj, prefix = '') {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string' && RULES[k]) yield [k, prefix, v]
    else if (v && typeof v === 'object') yield* leavesByLocale(v, key)
  }
}

export async function collect(root = process.cwd()) {
  const hits = []
  const repo = path.resolve(root, '..')
  for (const locale of Object.keys(RULES)) {
    const dir = path.resolve(root, 'src/locales', locale)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
      const mod = await import(pathToFileURL(path.join(dir, file)).href)
      for (const [key, value] of strings(mod.default)) check(locale, `${locale}/${file}`, key, value, hits)
    }
  }
  // desktop/main/*.json（不含转换字表）
  const desktopMain = path.join(repo, 'desktop/main')
  if (existsSync(desktopMain)) {
    for (const file of readdirSync(desktopMain).filter((f) => f.endsWith('.json') && f !== 'zh-hant-table.json').sort()) {
      const data = JSON.parse(readFileSync(path.join(desktopMain, file), 'utf8'))
      for (const [locale, key, value] of leavesByLocale(data)) check(locale, `desktop/main/${file}`, key, value, hits)
    }
  }
  // official-plugins/*/l10n/<locale>.json
  const plugins = path.join(repo, 'official-plugins')
  if (existsSync(plugins)) {
    for (const id of readdirSync(plugins).sort()) {
      for (const locale of Object.keys(RULES)) {
        const f = path.join(plugins, id, 'l10n', `${locale}.json`)
        if (!existsSync(f)) continue
        for (const [key, value] of strings(JSON.parse(readFileSync(f, 'utf8')))) check(locale, `official-plugins/${id}/l10n/${locale}.json`, key, value, hits)
      }
    }
  }
  // office-addin/taskpane/locales/<locale>.js（命名导出）
  for (const locale of Object.keys(RULES)) {
    const f = path.join(repo, 'office-addin/taskpane/locales', `${locale}.js`)
    if (!existsSync(f)) continue
    const mod = await import(pathToFileURL(f).href)
    for (const [key, v] of strings(mod.default)) check(locale, `office-addin/${locale}.js`, key, v, hits)
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
