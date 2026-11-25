// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 钉住已统一的术语，防止旧叫法回流（POLISH X 系列，术语以 docs/i18n/glossary.json 为准）：
// - 插件市场：zh-CN「插件市场」、zh-TW「外掛市集」、en「Marketplace」，旧叫法「插件广场/插件中心」等不许再出现；
// - 品牌是「包晴天」，不是「包青天」；
// - zh-TW 不许出现简体「后」，「返回」不许被转换成「回傳」（OpenCC 程序语境误转）。
// 只看 locale 的取值（import 后遍历），不看注释。
// 用法：node scripts/check-terminology.mjs（挂在 npm run check:locales 里一起跑）
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const RULES = {
  'zh-CN': [/插件广场/, /插件中心/, /包青天/],
  'zh-TW': [/外掛廣場/, /外掛中心/, /包青天/, /后/, /^回傳$/],
  'en-US': [/Plugin Marketplace/, /^Extensions$/],
}

function* strings(obj, prefix = '') {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') yield [key, v]
    else if (v && typeof v === 'object') yield* strings(v, key)
  }
}

let failed = 0
for (const [locale, rules] of Object.entries(RULES)) {
  const dir = path.resolve(process.cwd(), 'src/locales', locale)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href)
    for (const [key, value] of strings(mod.default)) {
      const hit = rules.find((re) => re.test(value))
      if (hit) {
        console.error(`✗ ${locale}/${file} ${key}: 「${value}」命中已停用叫法 ${hit}`)
        failed++
      }
    }
  }
}

if (failed) {
  console.error(`check-terminology: ${failed} 处旧术语，按 docs/i18n/glossary.json 改。`)
  process.exit(1)
}
console.log('✓ check-terminology: 插件市场 / 包晴天 / zh-TW 用字一致')
