#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Turn a throwaway source tree into a white-label edition before it is built.
// Design: docs/superpowers/specs/2026-11-23-brand-profile-design.md
//
//   node scripts/brand/apply.mjs --brand <id> [--root <tree>] [--dry-run]
//
// DESTRUCTIVE: rewrites files in place. Run it on a fresh checkout or a scratch worktree, never on a tree you
// commit from. The default brand (aiworkdeck) is a no-op, so normal builds are untouched.
//
// Steps: 1) brand.replace rules (exact, applied first, ignore keep-lines)  2) generic rules built from brand.json
// (name, hosts, support email, data dir) on every line except keep-lines  3) desktop/package.json identity
// 4) copy brands/<id>/overlay/** over the tree. Every rule must match at least once, so a rule that went stale
// after a code change fails loudly instead of silently shipping the old name.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// Directories (relative to the tree) whose shipped text is rewritten.
export const SCAN = [
  'desktop/main',
  'desktop/preload',
  'desktop/build',
  'desktop/scripts/brand-dev-electron.js',
  'frontend/src',
  'frontend/index.html',
  'frontend/plugin-app', // shell of the bundled business plugins (official-plugins/*/web)
  'backend/src/main',
  'backend/skills', // shipped as resources/skills
  'official-plugins', // bundled into the backend jar (lawfirm-management) or preinstalled (aifirm-partner)
  'office-addin', // the workbench imports office-addin/taskpane/lib; the add-ins themselves are phase 5
  'sdk/plugin-sdk', // awd-plugin-sdk.js is copied into bundled plugins
  'shared', // modules imported by both frontend and backend tooling
]
const SKIP_DIRS = new Set(['node_modules', 'test', 'tests', '__tests__', 'target', 'dist', 'unpackage', '.git'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.vue', '.json', '.java', '.yml', '.yaml', '.properties',
  '.html', '.htm', '.nsh', '.nsi', '.xml', '.plist', '.txt', '.css', '.scss', '.md', '.py', '.sql'])

// Lines left alone by the generic rules: AGPL attribution and source links must keep naming AI WorkDeck.
export const KEEP_LINE = [
  /SPDX-FileCopyrightText/,
  /github\.com\/AI-WorkDeck\//,
  /^\s*["']?(legalCopyright|portalSourceNotice)["']?\s*:/,
  /AIWorkDeck[/-]|UA_PRODUCT\s*=/, // outbound user agents: a server-side contract (ProductIdentity)
  /version object v1/, // VersionObjectPointer magic bytes, written into users' version stores
]

// Hosts that belong to shared services every edition talks to (the partner-network client portal), not to a brand.
// Read by backend PluginBundledInstaller.BRAND_LIST from the bundled-plugins directory.
export const BUNDLED_LIST = 'brand-bundled-plugins.json'

export const KEEP_HOSTS = new Set(['ai-firm.aiworkdeck.com', 'aifirm.aiworkdeck.com'])

export function genericRules(brand) {
  return [
    { name: 'support email', re: /hi@aiworkdeck\.com/g, to: brand.supportEmail, min: 1 },
    { name: 'hosts *.aiworkdeck.com', re: /\b((?:[a-z0-9-]+\.)*)aiworkdeck\.com\b/g, to: (m, sub) => (KEEP_HOSTS.has(m) ? m : `${sub}${brand.domain}`), min: 1 },
    { name: 'hosts *.workdeck.ai', re: /\b((?:[a-z0-9-]+\.)*)workdeck\.ai\b/g, to: (_, sub) => `${sub}${brand.domain}`, min: 1 },
    { name: 'data dir', re: /(?<![\w.-])\.aiworkdeck(?![\w.-])/g, to: brand.dataDirName, min: 1 },
    { name: 'update-signing key file name (comment)', re: /aiworkdeck_update_signing/g, to: `${brand.id}_update_signing`, min: 1 },
    { name: 'app id (Windows ProgID)', re: /com\.aiworkdeck\.desktop\b/g, to: brand.appId, min: 1 },
    { name: 'Codex MCP config id', re: /(?<=mcp_servers\.)aiworkdeck\b/g, to: brand.id, min: 1 },
    { name: 'local MCP server id', re: /(?<=realm=\\"|http |"name", ")aiworkdeck(?=-mcp\\"| |")/g, to: brand.id, min: 3 },
    { name: 'product name', re: /AI[ -]?Work[Dd]eck|WorkDeck AI/g, to: brand.name, min: 1 },
  ]
}

// brand.keyOverrides: { key: { "zh-CN": "...", "zh-TW": "...", "en": "..." } } replaces that key's value in every
// frontend locale file (other locales take "en"). For notices whose meaning changes with the brand (trademark).
const LOCALE_FILE = /^frontend\/src\/locales\/([a-zA-Z-]+)\//
export function overrideKeys(rel, text, overrides, hits) {
  const m = rel.split(path.sep).join('/').match(LOCALE_FILE)
  if (!m) return text
  for (const [key, byLocale] of Object.entries(overrides)) {
    const value = byLocale[m[1]] ?? byLocale.en
    text = text.replace(new RegExp(`^(\\s*["']?${key}["']?\\s*:\\s*)(["'])(?:(?!\\2)[^\\\\]|\\\\.)*\\2`, 'm'), (_, head, q) => {
      hits[`keyOverrides.${key}`] = (hits[`keyOverrides.${key}`] || 0) + 1
      return head + (q === '"' ? JSON.stringify(value) : `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
    })
  }
  return text
}

function* walk(root, rel) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) return
  const st = fs.statSync(abs)
  if (st.isFile()) { yield rel; return }
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(root, path.join(rel, e.name)) }
    else if (TEXT_EXT.has(path.extname(e.name))) yield path.join(rel, e.name)
  }
}

/** Rewrite one file's text. Returns the new text; adds per-rule hit counts into `hits`. */
export function rewriteText(text, exactRules, rules, hits) {
  for (const r of exactRules) {
    const n = text.split(r.from).length - 1
    if (n) { text = text.split(r.from).join(r.to); hits[r.name] = (hits[r.name] || 0) + n }
  }
  return text.split('\n').map((line) => {
    if (KEEP_LINE.some((k) => k.test(line))) return line
    for (const r of rules) {
      line = line.replace(r.re, (...m) => {
        hits[r.name] = (hits[r.name] || 0) + 1
        return typeof r.to === 'function' ? r.to(...m) : r.to
      })
    }
    return line
  }).join('\n')
}

function copyTree(from, to, copied, rel = '') {
  for (const e of fs.readdirSync(path.join(from, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name)
    if (e.isDirectory()) copyTree(from, to, copied, r)
    else { fs.mkdirSync(path.dirname(path.join(to, r)), { recursive: true }); fs.copyFileSync(path.join(from, r), path.join(to, r)); copied.push(r) }
  }
}

export function loadBrand(id, brandsDir = path.join(HERE, '../../brands')) {
  const brand = JSON.parse(fs.readFileSync(path.join(brandsDir, id, 'brand.json'), 'utf8'))
  return { brand, dir: path.join(brandsDir, id) }
}

export function applyBrand({ id, root, dryRun = false, log = console.log, brandsDir }) {
  const { brand, dir } = loadBrand(id, brandsDir)
  if (brand.id === 'aiworkdeck') { log('default brand: nothing to do'); return { changed: [], hits: {} } }
  const exact = (brand.replace || []).map((r, i) => ({ name: r.name || `replace[${i}]`, from: r.from, to: r.to, min: r.min ?? 1 }))
  const rules = genericRules(brand)
  const hits = {}
  const changed = []
  for (const top of SCAN) {
    for (const rel of walk(root, top)) {
      const abs = path.join(root, rel)
      const before = fs.readFileSync(abs, 'utf8')
      let after = rewriteText(before, exact, rules, hits)
      after = overrideKeys(rel, after, brand.keyOverrides || {}, hits)
      if (after !== before) { changed.push(rel); if (!dryRun) fs.writeFileSync(abs, after) }
    }
  }

  // Packaging identity.
  const pkgPath = path.join(root, 'desktop/package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.name = brand.packageName
  pkg.description = brand.name
  // Windows exe "CompanyName" comes from author; AGPL attribution stays in copyright.
  pkg.author = brand.operatorShort || brand.name
  Object.assign(pkg.build, { appId: brand.appId, productName: brand.name, copyright: brand.copyright })
  pkg.build.dmg.title = `${brand.name} \${version}`
  pkg.build.nsis.shortcutName = brand.name
  // bundledPlugins (optional): official plugins this edition preinstalls. They ship with the other host-distributed
  // plugins (resources/official-plugins) and PluginBundledInstaller installs them from the list file written here.
  // stage-bundled-plugins.mjs adds the SDK and the backend JARs once Maven is available.
  const bundled = brand.bundledPlugins || []
  if (bundled.length) {
    const res = pkg.build.extraResources.find((r) => r.to === 'official-plugins')
    for (const id of bundled) {
      if (!fs.existsSync(path.join(root, 'official-plugins', id, 'manifest.json'))) throw new Error(`bundledPlugins: no official-plugins/${id}`)
      res.filter.push(`${id}/manifest.json`, `${id}/web/**`, `${id}/l10n/**`, `${id}/assets/**`, `${id}/*.jar`)
    }
    res.filter.push(BUNDLED_LIST)
    if (!dryRun) fs.writeFileSync(path.join(root, 'official-plugins', BUNDLED_LIST), JSON.stringify(bundled) + '\n')
    changed.push(`official-plugins/${BUNDLED_LIST}`)
  }
  if (!dryRun) fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  changed.push('desktop/package.json')

  // Runtime marker (desktop/main/brand.json): tags the backend fingerprint so two brands on one machine never
  // reuse each other's backend (backend-service.js homeTag).
  // defaultLanguage (optional): the UI language until the user picks one, instead of the OS language.
  const marker = { id: brand.id, ...(brand.defaultLanguage ? { defaultLanguage: brand.defaultLanguage } : {}) }
  if (!dryRun) fs.writeFileSync(path.join(root, 'desktop/main/brand.json'), JSON.stringify(marker, null, 2) + '\n')
  changed.push('desktop/main/brand.json')

  const overlay = path.join(dir, 'overlay')
  const copied = []
  if (fs.existsSync(overlay) && !dryRun) copyTree(overlay, root, copied)

  const overrideRules = Object.keys(brand.keyOverrides || {}).map((k) => ({ name: `keyOverrides.${k}`, min: 1 }))
  const stale = [...exact, ...rules, ...overrideRules].filter((r) => (hits[r.name] || 0) < r.min).map((r) => r.name)
  for (const [name, n] of Object.entries(hits)) log(`  ${String(n).padStart(5)}  ${name}`)
  log(`${changed.length} files rewritten, ${copied.length} overlay files copied`)
  if (stale.length) throw new Error(`brand rules matched nothing (stale?): ${stale.join(', ')}`)
  return { changed, copied, hits }
}

if (process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
  const id = arg('--brand')
  if (!id) { console.error('usage: apply.mjs --brand <id> [--root <tree>] [--dry-run]'); process.exit(2) }
  const root = path.resolve(arg('--root') || path.join(HERE, '../..'))
  try { applyBrand({ id, root, dryRun: process.argv.includes('--dry-run') }) }
  catch (e) { console.error(e.message); process.exit(1) }
}
