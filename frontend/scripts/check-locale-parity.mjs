#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  LOCALE_REGISTRY,
  SUPPORTED_LOCALE_CODES,
  getLocaleEntry,
} from '../src/locales/registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

const STRICT_ALL_LOCALES = process.env.STRICT_ALL_LOCALES !== '0'
const HAN_RE = /\p{Script=Han}/u
const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g

// Deliberate exceptions where a non-CJK locale intentionally contains Han characters
// (e.g. a language-switcher label naming "中文" or a Chinese legal statute title cited verbatim).
const NON_HAN_ALLOWLIST = new Set([
  'frontend:onboarding.unlock.langZh',
  'frontend:market.styleProfileNote',
  'frontend:panels.litCreditText',
  'frontend:workbench.pluginDevAiPrompt',
  'office-addin:langZh',
])

const errors = []
const coverageReports = []

function fail(scope, message) {
  errors.push(`[${scope}] ${message}`)
}

function flatten(obj, prefix = '', out = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, key, out)
    } else {
      out[key] = v
    }
  }
  return out
}

function extractPlaceholders(str) {
  if (typeof str !== 'string') return []
  const set = new Set()
  for (const m of str.matchAll(PLACEHOLDER_RE)) {
    set.add(m[1])
  }
  return [...set].sort()
}

function compareLocaleMaps(scope, zhMap, targetMap, localeCode, { strictKeys = false } = {}) {
  const entry = getLocaleEntry(localeCode)
  const allowHan = Boolean(entry && entry.allowHan)
  const zhKeys = new Set(Object.keys(zhMap))
  const targetKeys = new Set(Object.keys(targetMap))

  let translatedCount = 0

  if (strictKeys) {
    for (const k of zhKeys) {
      if (!targetKeys.has(k)) {
        fail(scope, `Missing ${localeCode} key: ${k}`)
      }
    }
  }

  for (const k of targetKeys) {
    if (!zhKeys.has(k)) {
      fail(scope, `Unknown ${localeCode} key (not in zh-CN): ${k}`)
    }
  }

  for (const k of zhKeys) {
    if (!targetKeys.has(k)) continue
    const zhVal = zhMap[k]
    const targetVal = targetMap[k]
    if (typeof zhVal !== 'string' || !zhVal.trim()) {
      fail(scope, `Empty or non-string zh-CN value at: ${k}`)
    }
    if (typeof targetVal !== 'string' || !targetVal.trim()) {
      fail(scope, `Empty or non-string ${localeCode} value at: ${k}`)
      continue
    }
    translatedCount += 1
    if (!allowHan && HAN_RE.test(targetVal) && !NON_HAN_ALLOWLIST.has(`${scope}:${k}`)) {
      fail(scope, `${localeCode} value contains Han characters at ${k}: ${JSON.stringify(targetVal)}`)
    }
    const zhPh = extractPlaceholders(zhVal)
    const targetPh = extractPlaceholders(targetVal)
    if (zhPh.join(',') !== targetPh.join(',')) {
      fail(
        scope,
        `Placeholder mismatch at ${k} (${localeCode}): zh-CN={${zhPh.join(',')}} vs ${localeCode}={${targetPh.join(',')}}`
      )
    }
  }

  return {
    total: zhKeys.size,
    translated: translatedCount,
    pct: zhKeys.size ? ((translatedCount / zhKeys.size) * 100).toFixed(1) : '100.0',
  }
}

async function loadDefaultExport(filePath) {
  const mod = await import(pathToFileURL(filePath).href)
  return mod.default || mod
}

async function checkFrontendLocales() {
  const localesRoot = path.join(repoRoot, 'frontend/src/locales')
  const zhDir = path.join(localesRoot, 'zh-CN')
  const enDir = path.join(localesRoot, 'en-US')
  if (!fs.existsSync(zhDir) || !fs.existsSync(enDir)) {
    fail('frontend', 'Missing frontend/src/locales/zh-CN or en-US directory')
    return
  }

  const zhFiles = fs.readdirSync(zhDir).filter((f) => f.endsWith('.js')).sort()
  const zhFlatAll = {}
  for (const f of zhFiles) {
    const ns = path.basename(f, '.js')
    const zhObj = await loadDefaultExport(path.join(zhDir, f))
    flatten(zhObj, ns, zhFlatAll)
  }

  const presentDirs = fs.readdirSync(localesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  const localesToCheck = STRICT_ALL_LOCALES
    ? SUPPORTED_LOCALE_CODES.filter((c) => c !== 'zh-CN')
    : presentDirs.filter((c) => c !== 'zh-CN')

  for (const localeCode of localesToCheck) {
    const dir = path.join(localesRoot, localeCode)
    const isStrict = localeCode === 'en-US' || STRICT_ALL_LOCALES
    if (!fs.existsSync(dir)) {
      if (isStrict) {
        fail('frontend', `Missing required locale directory: frontend/src/locales/${localeCode}`)
      }
      continue
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
    const zhSet = new Set(zhFiles)
    const locSet = new Set(files)

    if (isStrict) {
      for (const f of zhFiles) {
        if (!locSet.has(f)) fail('frontend', `Missing ${localeCode} locale file: ${f}`)
      }
    }
    for (const f of files) {
      if (!zhSet.has(f)) fail('frontend', `Unknown ${localeCode} locale file (not in zh-CN): ${f}`)
    }

    const targetFlatAll = {}
    for (const f of files) {
      if (!zhSet.has(f)) continue
      const ns = path.basename(f, '.js')
      const locObj = await loadDefaultExport(path.join(dir, f))
      flatten(locObj, ns, targetFlatAll)
    }

    const stats = compareLocaleMaps('frontend', zhFlatAll, targetFlatAll, localeCode, {
      strictKeys: isStrict,
    })
    coverageReports.push(`frontend [${localeCode}]: ${stats.translated}/${stats.total} (${stats.pct}%)`)
  }
}

async function checkOfficeAddin() {
  const localesDir = path.join(repoRoot, 'office-addin/taskpane/locales')
  const i18nPath = path.join(repoRoot, 'office-addin/taskpane/lib/i18n.js')
  if (!fs.existsSync(i18nPath)) {
    fail('office-addin', 'Missing office-addin/taskpane/lib/i18n.js')
    return
  }
  const mod = await import(pathToFileURL(i18nPath).href)
  if (!mod.ZH || !mod.EN) {
    fail('office-addin', 'office-addin/taskpane/lib/i18n.js must export ZH and EN')
    return
  }
  const zhMap = flatten(mod.ZH)

  // Always check EN strictly
  const enStats = compareLocaleMaps('office-addin', zhMap, flatten(mod.EN), 'en-US', {
    strictKeys: true,
  })
  coverageReports.push(`office-addin [en-US]: ${enStats.translated}/${enStats.total} (${enStats.pct}%)`)

  if (!fs.existsSync(localesDir)) return

  const presentFiles = fs.readdirSync(localesDir)
    .filter((f) => f.endsWith('.js') && f !== 'registry.js' && f !== 'zh-CN.js' && f !== 'en-US.js')
    .map((f) => path.basename(f, '.js'))
    .sort()

  const localesToCheck = STRICT_ALL_LOCALES
    ? SUPPORTED_LOCALE_CODES.filter((c) => c !== 'zh-CN' && c !== 'en-US')
    : presentFiles

  for (const localeCode of localesToCheck) {
    const filePath = path.join(localesDir, `${localeCode}.js`)
    if (!fs.existsSync(filePath)) {
      if (STRICT_ALL_LOCALES) {
        fail('office-addin', `Missing required locale file: office-addin/taskpane/locales/${localeCode}.js`)
      }
      continue
    }
    const locObj = await loadDefaultExport(filePath)
    const stats = compareLocaleMaps('office-addin', zhMap, flatten(locObj), localeCode, {
      strictKeys: STRICT_ALL_LOCALES,
    })
    coverageReports.push(`office-addin [${localeCode}]: ${stats.translated}/${stats.total} (${stats.pct}%)`)
  }
}

function checkOfficialPlugins() {
  const pluginsRoot = path.join(repoRoot, 'official-plugins')
  if (!fs.existsSync(pluginsRoot)) return
  const entries = fs.readdirSync(pluginsRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pluginId = entry.name
    const l10nDir = path.join(pluginsRoot, pluginId, 'l10n')
    const zhPath = path.join(l10nDir, 'zh-CN.json')
    const enPath = path.join(l10nDir, 'en-US.json')
    if (!fs.existsSync(zhPath) && !fs.existsSync(enPath)) continue
    if (!fs.existsSync(zhPath)) {
      fail(`plugin:${pluginId}`, 'Missing l10n/zh-CN.json')
      continue
    }
    if (!fs.existsSync(enPath)) {
      fail(`plugin:${pluginId}`, 'Missing l10n/en-US.json')
      continue
    }
    const zh = flatten(JSON.parse(fs.readFileSync(zhPath, 'utf8')))

    const presentCodes = fs.readdirSync(l10nDir)
      .filter((f) => f.endsWith('.json') && f !== 'zh-CN.json')
      .map((f) => path.basename(f, '.json'))
      .sort()

    const localesToCheck = STRICT_ALL_LOCALES
      ? SUPPORTED_LOCALE_CODES.filter((c) => c !== 'zh-CN')
      : presentCodes

    for (const localeCode of localesToCheck) {
      const locPath = path.join(l10nDir, `${localeCode}.json`)
      const isStrict = localeCode === 'en-US' || STRICT_ALL_LOCALES
      if (!fs.existsSync(locPath)) {
        if (isStrict) {
          fail(`plugin:${pluginId}`, `Missing l10n/${localeCode}.json`)
        }
        continue
      }
      const target = flatten(JSON.parse(fs.readFileSync(locPath, 'utf8')))
      compareLocaleMaps(`plugin:${pluginId}`, zh, target, localeCode, {
        strictKeys: isStrict,
      })
    }
  }
}

/**
 * Guardrail 1: every backend @ToolMeta(name="...", displayName="...") must be
 * registered in frontend/src/utils/toolDisplayNames.js with both zh and en.
 */
function checkToolDisplayNames() {
  const tdPath = path.join(repoRoot, 'frontend/src/utils/toolDisplayNames.js')
  const backendRoot = path.join(repoRoot, 'backend/src/main/java')
  if (!fs.existsSync(tdPath) || !fs.existsSync(backendRoot)) return

  const tdSrc = fs.readFileSync(tdPath, 'utf8')
  const feTools = new Map()
  const entryRe = /^\s*([a-zA-Z0-9_]+)\s*:\s*\{\s*zh\s*:\s*(['"`])((?:\\.|(?!\2).)*)\2\s*,\s*en\s*:\s*(['"`])((?:\\.|(?!\4).)*)\4\s*\}/gm
  for (const m of tdSrc.matchAll(entryRe)) {
    feTools.set(m[1], { zh: m[3], en: m[5] })
  }

  for (const [name, pair] of feTools.entries()) {
    if (!pair.zh.trim() || !pair.en.trim()) {
      fail('toolDisplayNames', `Tool "${name}" has empty zh or en label`)
    }
    if (HAN_RE.test(pair.en)) {
      fail('toolDisplayNames', `Tool "${name}" en label contains Han characters: ${pair.en}`)
    }
  }

  function walkJava(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walkJava(full, out)
      else if (e.isFile() && e.name.endsWith('.java')) out.push(full)
    }
    return out
  }

  const toolMetaRe = /@ToolMeta\s*\(([\s\S]*?)\)/g
  for (const jf of walkJava(backendRoot)) {
    const src = fs.readFileSync(jf, 'utf8')
    for (const m of src.matchAll(toolMetaRe)) {
      const body = m[1]
      const nameM = body.match(/\bname\s*=\s*"([^"]+)"/)
      const dispM = body.match(/\bdisplayName\s*=\s*"([^"]+)"/)
      if (!nameM || !dispM) continue
      const toolName = nameM[1]
      if (!feTools.has(toolName)) {
        const rel = path.relative(repoRoot, jf)
        fail(
          'toolDisplayNames',
          `Backend tool "${toolName}" (${rel}) has @ToolMeta(displayName="${dispM[1]}") but is missing from frontend/src/utils/toolDisplayNames.js`
        )
      }
    }
  }
}

/**
 * Guardrail 2: scan frontend/src/{pages,components}/*.vue <template> blocks
 * for bare hardcoded Chinese UI text not wrapped in $t(...) / t(...) / tr(...).
 */
function checkVueTemplates() {
  const roots = [
    path.join(repoRoot, 'frontend/src/pages'),
    path.join(repoRoot, 'frontend/src/components')
  ]

  function walkVue(dir, out = []) {
    if (!fs.existsSync(dir)) return out
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walkVue(full, out)
      else if (e.isFile() && e.name.endsWith('.vue')) out.push(full)
    }
    return out
  }

  const vueFiles = roots.flatMap((r) => walkVue(r))
  for (const vf of vueFiles) {
    const src = fs.readFileSync(vf, 'utf8')
    const tplM = src.match(/<template[^>]*>([\s\S]*?)<\/template>/)
    if (!tplM) continue
    const tplStartLine = src.slice(0, tplM.index).split('\n').length
    // Strip HTML comments while preserving line count
    const cleaned = tplM[1].replace(/<!--[\s\S]*?-->/g, (comment) =>
      comment.replace(/[^\n]/g, '')
    )
    const lines = cleaned.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!HAN_RE.test(line)) continue
      // Allow lines that already use i18n / inline translation helpers or console logging
      if (/(\$t|\bt|\btr)\s*\(/.test(line)) continue
      if (/console\.(log|warn|error)/.test(line)) continue
      const rel = path.relative(repoRoot, vf)
      const lineNo = tplStartLine + i
      fail(
        'vue-template',
        `${rel}:${lineNo} contains bare Chinese text in <template>: ${line.trim()}`
      )
    }
  }
}

await checkFrontendLocales()
await checkOfficeAddin()
checkOfficialPlugins()
checkToolDisplayNames()
checkVueTemplates()

if (coverageReports.length > 0) {
  console.log(`Locale coverage (${LOCALE_REGISTRY.length} registered locales, STRICT_ALL_LOCALES=${STRICT_ALL_LOCALES ? '1' : '0'}):`)
  for (const line of coverageReports) {
    console.log(`  - ${line}`)
  }
}

if (errors.length > 0) {
  console.error(`Locale parity check failed with ${errors.length} error(s):`)
  for (const err of errors) {
    console.error(`  - ${err}`)
  }
  process.exit(1)
}

console.log('Locale parity check passed (frontend, office-addin, official-plugins, toolDisplayNames, vue-templates).')
