// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 锁 zh-CN / en-US 两侧命名空间、键集合、占位符 {var} 完全一致，en-US 不含未豁免中文字符，且 .vue <template> 禁止裸中文文案（漏译=构建期红，不是运行期回退）。
// 用法：node scripts/check-locale-parity.mjs（npm run check:locales）
import { readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const srcRoot = path.resolve(process.cwd(), 'src')
const root = path.join(srcRoot, 'locales')
const langs = ['zh-CN', 'en-US']
const HAN_RE = /\p{Script=Han}/u
const PLACEHOLDER_RE = /\{(\w+)\}/g
const EN_HAN_ALLOWLIST = new Set([
  'market.js:styleProfileNote',
  'panels.js:litCreditText',
  'workbench.js:pluginDevAiPrompt',
  'office-addin:langZh'
])

function listNs(lang) {
  try {
    return readdirSync(path.join(root, lang)).filter((f) => f.endsWith('.js')).sort()
  } catch (e) {
    return []
  }
}

function flattenEntries(obj, prefix = '') {
  const entries = new Map()
  for (const [k, v] of Object.entries(obj || {})) {
    const full = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') {
      for (const [subKey, subVal] of flattenEntries(v, full)) entries.set(subKey, subVal)
    } else {
      entries.set(full, v)
    }
  }
  return entries
}

function extractPlaceholders(val) {
  if (typeof val !== 'string') return []
  return [...new Set([...val.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))].sort()
}

let failed = false
const [zhFiles, enFiles] = langs.map(listNs)

for (const f of new Set([...zhFiles, ...enFiles])) {
  if (!zhFiles.includes(f)) { console.error(`✗ zh-CN 缺少命名空间文件 ${f}`); failed = true; continue }
  if (!enFiles.includes(f)) { console.error(`✗ en-US 缺少命名空间文件 ${f}`); failed = true; continue }
  const [zhMap, enMap] = await Promise.all(langs.map(async (lang) => {
    const mod = await import(pathToFileURL(path.join(root, lang, f)).href)
    return flattenEntries(mod.default)
  }))
  for (const k of zhMap.keys()) if (!enMap.has(k)) { console.error(`✗ ${f}: en-US 缺键 ${k}`); failed = true }
  for (const k of enMap.keys()) if (!zhMap.has(k)) { console.error(`✗ ${f}: zh-CN 缺键 ${k}`); failed = true }
  for (const [k, enVal] of enMap.entries()) {
    const allowKey = `${f}:${k}`
    if (typeof enVal === 'string' && HAN_RE.test(enVal) && !EN_HAN_ALLOWLIST.has(allowKey)) {
      console.error(`✗ ${f}: en-US 键 ${k} 含未豁免中文字符: ${enVal}`)
      failed = true
    }
    if (zhMap.has(k)) {
      const zhPh = extractPlaceholders(zhMap.get(k))
      const enPh = extractPlaceholders(enVal)
      if (zhPh.join(',') !== enPh.join(',')) {
        console.error(`✗ ${f}: 键 ${k} 占位符不一致 zh-CN=[${zhPh.join(', ')}] vs en-US=[${enPh.join(', ')}]`)
        failed = true
      }
    }
  }
}

function walkVueFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name)
    return d.isDirectory() ? walkVueFiles(full) : (d.name.endsWith('.vue') ? [full] : [])
  })
}

const vueFiles = walkVueFiles(srcRoot)
for (const vuePath of vueFiles) {
  const src = readFileSync(vuePath, 'utf8')
  const match = src.match(/<template>([\s\S]*?)<\/template>/)
  if (!match) continue
  const tpl = match[1].replace(/<!--[\s\S]*?-->/g, '')
  const lines = tpl.split('\n')
  lines.forEach((line, idx) => {
    if (!HAN_RE.test(line)) return
    if (/(?:\$t|(?<![\w$])t|(?<![\w$])tr)\s*\(/.test(line)) return
    const rel = path.relative(srcRoot, vuePath)
    console.error(`✗ ${rel} (template line ${idx + 1}): 发现未走 i18n 的裸中文文案: ${line.trim()}`)
    failed = true
  })
}

const pluginsRoot = path.resolve(process.cwd(), '../official-plugins')
let pluginCount = 0
try {
  const pluginDirs = readdirSync(pluginsRoot, { withFileTypes: true }).filter((d) => d.isDirectory())
  for (const dir of pluginDirs) {
    const l10nDir = path.join(pluginsRoot, dir.name, 'l10n')
    try {
      const zhJson = JSON.parse(readFileSync(path.join(l10nDir, 'zh-CN.json'), 'utf8'))
      const enJson = JSON.parse(readFileSync(path.join(l10nDir, 'en-US.json'), 'utf8'))
      pluginCount++
      for (const k of Object.keys(zhJson)) {
        if (!(k in enJson)) {
          console.error(`✗ official-plugins/${dir.name}/l10n/en-US.json 缺键: ${k}`)
          failed = true
        }
      }
      for (const [k, enVal] of Object.entries(enJson)) {
        if (!(k in zhJson)) {
          console.error(`✗ official-plugins/${dir.name}/l10n/zh-CN.json 缺键: ${k}`)
          failed = true
        }
        if (typeof enVal === 'string' && HAN_RE.test(enVal)) {
          console.error(`✗ official-plugins/${dir.name}/l10n/en-US.json 键 ${k} 含中文字符: ${enVal}`)
          failed = true
        }
      }
    } catch (e) {
      console.error(`✗ official-plugins/${dir.name} 缺少或无法解析 l10n/zh-CN.json 与 l10n/en-US.json: ${e.message}`)
      failed = true
    }
  }
} catch (_) {}

let addinKeyCount = 0
try {
  const addinI18nPath = path.resolve(process.cwd(), '../office-addin/taskpane/lib/i18n.js')
  const { ZH, EN } = await import(pathToFileURL(addinI18nPath).href)
  addinKeyCount = Object.keys(ZH || {}).length
  for (const k of Object.keys(ZH || {})) {
    if (!(k in (EN || {}))) {
      console.error(`✗ office-addin/taskpane/lib/i18n.js EN 缺键: ${k}`)
      failed = true
    }
  }
  for (const [k, enVal] of Object.entries(EN || {})) {
    if (!(k in (ZH || {}))) {
      console.error(`✗ office-addin/taskpane/lib/i18n.js ZH 缺键: ${k}`)
      failed = true
    }
    if (typeof enVal === 'string' && HAN_RE.test(enVal) && !EN_HAN_ALLOWLIST.has(`office-addin:${k}`)) {
      console.error(`✗ office-addin/taskpane/lib/i18n.js EN 键 ${k} 含中文字符: ${enVal}`)
      failed = true
    }
    if (k in (ZH || {})) {
      const zhPh = extractPlaceholders(ZH[k])
      const enPh = extractPlaceholders(enVal)
      if (zhPh.join(',') !== enPh.join(',')) {
        console.error(`✗ office-addin/taskpane/lib/i18n.js 键 ${k} 占位符不一致 ZH=[${zhPh.join(', ')}] vs EN=[${enPh.join(', ')}]`)
        failed = true
      }
    }
  }
} catch (e) {
  console.error(`✗ office-addin/taskpane/lib/i18n.js 校验失败: ${e.message}`)
  failed = true
}

if (failed) process.exit(1)
console.log(`✓ locale 键/占位符/英文纯度/Vue模板裸中文/官方插件l10n/Office插件i18n对拍通过（${zhFiles.length} 个命名空间，${vueFiles.length} 个 .vue 文件，${pluginCount} 个官方插件，${addinKeyCount} 个 Office 插件词条）`)
