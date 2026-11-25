// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// zh-TW copy must not carry the fingerprints of mechanical Simplified→Traditional conversion
// (readiness POLISH Q4): 并 "and" written as 併 (should be 並), 发 "send/issue" written as 髮 ("hair").
// Legit words keep their characters: 合併/兼併/吞併/併購/併入/歸併/併案/一併, 頭髮/理髮/髮型.
// Scans the workbench zh-TW locales, the Office/WPS add-in zh-TW locale and official plugin zh-TW l10n.
// Usage: node scripts/check-zh-tw-conversion.mjs (part of npm run check:locales)
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const repo = path.resolve(process.cwd(), '..')
const files = []
const dir = path.join(repo, 'frontend/src/locales/zh-TW')
for (const f of readdirSync(dir)) if (f.endsWith('.js')) files.push(path.join(dir, f))
for (const f of ['office-addin/taskpane/locales/zh-TW.js']) if (existsSync(path.join(repo, f))) files.push(path.join(repo, f))
const pluginsDir = path.join(repo, 'official-plugins')
for (const p of readdirSync(pluginsDir)) {
  const f = path.join(pluginsDir, p, 'l10n/zh-TW.json')
  if (existsSync(f)) files.push(f)
}

const RULES = [
  { ch: '併', ok: /合併|兼併|吞併|併購|併入|歸併|併案|一併/g, fix: '並' },
  { ch: '髮', ok: /頭髮|理髮|髮型|毛髮/g, fix: '發' },
]
let bad = 0
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const r of RULES) {
      if (!line.replace(r.ok, '').includes(r.ch)) continue
      bad++
      console.error(`✗ ${path.relative(repo, file)}:${i + 1}: 「${r.ch}」 looks like a conversion error (usually 「${r.fix}」): ${line.trim().slice(0, 80)}`)
    }
  })
}
if (bad) { console.error(`check-zh-tw-conversion: ${bad} suspicious line(s)`); process.exit(1) }
console.log(`check-zh-tw-conversion: OK (${files.length} zh-TW files)`)
