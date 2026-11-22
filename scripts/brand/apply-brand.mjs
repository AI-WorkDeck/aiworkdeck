#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 品牌配置的唯一分发出口（rfcs/2026-11-21-brand-profile.md §3）。
//
//   node scripts/brand/apply-brand.mjs                    # 默认品牌 aiworkdeck
//   node scripts/brand/apply-brand.mjs --brand example    # brands/example/
//   node scripts/brand/apply-brand.mjs --brand-dir <dir>  # 本仓之外的品牌目录
//
// 写出：
//   desktop/main/brand.json                    主进程运行期配置（以默认品牌内容入库）
//   frontend/src/brand/brand.json              前端运行期配置（以默认品牌内容入库）
//   desktop/build/brand/electron-builder.json  贴牌构建用的完整 electron-builder 配置（不入库）
//   assets 中列出的素材覆盖到对应位置
// 默认品牌重跑必须零差异（CI：apply-brand 后 git diff --exit-code）。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_BRAND = 'aiworkdeck'

// 素材键 → 仓库内落点（覆盖同名文件，代码引用不变）
export const ASSET_TARGETS = {
  icon: 'desktop/build/icon.png',
  dmgBackground: 'desktop/build/background.png',
  dmgBackground2x: 'desktop/build/background@2x.png',
  logoFull: 'frontend/src/static/logo_full_v2.png',
  iconmark: 'frontend/src/static/iconmark_v2.png',
  appIcon: 'frontend/src/static/icon.png',
}

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/
const APP_ID_RE = /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)+$/
const DIR_RE = /^\.?[a-z0-9][a-z0-9._-]{1,63}$/

export function validate(brand) {
  const errors = []
  const need = (cond, msg) => { if (!cond) errors.push(msg) }
  need(brand && typeof brand === 'object', 'brand.json 必须是对象')
  if (errors.length) return errors
  need(ID_RE.test(String(brand.id || '')), 'id 须为小写字母开头的 2–32 位 [a-z0-9-]')
  need(typeof brand.name === 'string' && brand.name.trim().length > 0, 'name 不能为空')
  need(APP_ID_RE.test(String(brand.appId || '')), 'appId 须为反向域名，如 com.example.desk')
  need(DIR_RE.test(String(brand.dataDirName || '')), 'dataDirName 须为单级目录名，如 .exampledesk')
  need(brand.userDataDirName == null || DIR_RE.test(String(brand.userDataDirName)), 'userDataDirName 须为单级目录名或 null')
  need(brand.site == null || ['cn', 'intl'].includes(brand.site), 'site 只能是 cn、intl 或 null')
  const u = brand.update || {}
  need(Array.isArray(u.manifestUrls) && u.manifestUrls.every((x) => /^https:\/\//.test(x)), 'update.manifestUrls 须为 https 地址数组')
  need(typeof u.downloadPage === 'string' && /^https:\/\//.test(u.downloadPage), 'update.downloadPage 须为 https 地址')
  const bp = brand.bundledPlugins || {}
  need(Array.isArray(bp.add) && Array.isArray(bp.remove), 'bundledPlugins 须含 add、remove 数组')
  need(brand.gate == null || (typeof brand.gate.feature === 'string' && brand.gate.feature.length > 0), 'gate 须为 null 或含 feature')
  for (const k of Object.keys(brand.assets || {})) need(k in ASSET_TARGETS, `未知素材键 ${k}`)
  if (brand.id !== DEFAULT_BRAND) {
    // 贴牌版必须与 AI WorkDeck 并装不串数据
    need(brand.appId !== 'com.aiworkdeck.desktop', '贴牌版 appId 不能沿用 com.aiworkdeck.desktop')
    need(brand.dataDirName !== '.aiworkdeck', '贴牌版 dataDirName 不能沿用 .aiworkdeck')
    need(!!brand.userDataDirName && brand.userDataDirName !== 'aiworkdeck-desktop', '贴牌版须设独立 userDataDirName')
  }
  return errors
}

/** 运行期配置：只放运行时要用的字段，素材与构建项不进安装包。 */
export function runtimeProfile(brand) {
  return {
    id: brand.id,
    name: brand.name,
    dataDirName: brand.dataDirName,
    userDataDirName: brand.userDataDirName ?? null,
    site: brand.site ?? null,
    update: { manifestUrls: brand.update.manifestUrls, downloadPage: brand.update.downloadPage },
    gate: brand.gate ?? null,
  }
}

function deepMerge(base, over) {
  if (Array.isArray(over) || over === null || typeof over !== 'object') return over
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) }
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(out[k], v)
  return out
}

/** 贴牌构建用的完整 electron-builder 配置：package.json build 段 + 品牌覆盖。 */
// 预装插件（bundledPlugins）要同时改 extraResources 过滤表与后端 PluginBundledInstaller.IDS，属 P2，这里不处理。
export function builderConfig(pkgBuild, brand) {
  return deepMerge(pkgBuild, {
    appId: brand.appId,
    productName: brand.name,
    dmg: { title: `${brand.name} \${version}` },
    nsis: { shortcutName: brand.name },
  })
}

const json = (v) => JSON.stringify(v, null, 2) + '\n'

function writeIfChanged(file, content) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (prev === content) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return true
}

export function loadBrand({ brand, brandDir }) {
  const dir = brandDir ? path.resolve(brandDir) : path.join(ROOT, 'brands', brand || DEFAULT_BRAND)
  const file = path.join(dir, 'brand.json')
  if (!fs.existsSync(file)) throw new Error(`找不到品牌配置 ${file}`)
  return { dir, profile: JSON.parse(fs.readFileSync(file, 'utf8')) }
}

export function apply({ brand, brandDir, root = ROOT, log = console.log } = {}) {
  const { dir, profile } = loadBrand({ brand, brandDir })
  const errors = validate(profile)
  if (errors.length) throw new Error(`品牌配置无效（${dir}）：\n- ${errors.join('\n- ')}`)

  const runtime = json(runtimeProfile(profile))
  const changed = []
  for (const rel of ['desktop/main/brand.json', 'frontend/src/brand/brand.json']) {
    if (writeIfChanged(path.join(root, rel), runtime)) changed.push(rel)
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'desktop', 'package.json'), 'utf8'))
  const builderRel = 'desktop/build/brand/electron-builder.json'
  if (writeIfChanged(path.join(root, builderRel), json(builderConfig(pkg.build, profile)))) changed.push(builderRel)

  for (const [key, rel] of Object.entries(profile.assets || {})) {
    const src = path.resolve(dir, rel)
    if (!src.startsWith(dir + path.sep)) throw new Error(`素材 ${key} 越出品牌目录：${rel}`)
    const dest = path.join(root, ASSET_TARGETS[key])
    const buf = fs.readFileSync(src)
    if (!fs.existsSync(dest) || !buf.equals(fs.readFileSync(dest))) {
      fs.copyFileSync(src, dest)
      changed.push(ASSET_TARGETS[key])
    }
  }
  log(`[brand] ${profile.id}（${profile.name}）${changed.length ? '写出：\n  ' + changed.join('\n  ') : '无变化'}`)
  return { profile, changed }
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--brand') out.brand = argv[++i]
    else if (argv[i] === '--brand-dir') out.brandDir = argv[++i]
    else throw new Error(`未知参数 ${argv[i]}`)
  }
  return out
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    apply(parseArgs(process.argv.slice(2)))
  } catch (e) {
    console.error(String(e.message || e))
    process.exit(1)
  }
}
