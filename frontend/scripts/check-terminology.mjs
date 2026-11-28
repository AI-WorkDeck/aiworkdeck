// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 钉住已统一的术语，防止旧叫法回流（POLISH X 系列，术语以 docs/i18n/glossary.json 为准）：
// - 插件市场：zh-CN「插件市场」、zh-TW「外掛市集」、en「Marketplace」，旧叫法「插件广场/插件中心」等不许再出现；
// - 品牌是「包晴天」，不是「包青天」；
// - en 用 Sign In / Sign Out（不用 Log In / Login / Log Out）；「懒人模式 / Lazy Mode」已改名为自动启用；
// - zh-TW「并」（和、并且）不许被 OpenCC 误转成「併」（合併、一併、併入、併購除外）；
// - 中文界面用「技能」「插件/外掛」，不夹英文 Skill / Plugin（技能文件名 skill.yml 小写不受影响）；
// - zh-TW 不许出现简体「后」，「返回」不许被转换成「回傳」（OpenCC 程序语境误转）。
// 只看 locale 的取值（import 后遍历），不看注释。
// 用法：node scripts/check-terminology.mjs（挂在 npm run check:locales 里一起跑）
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const RULES = {
  'zh-CN': [/插件广场/, /插件中心/, /包青天/, /懒人模式/, /Skill/, /Plugin/],
  // 客户访问码在 zh-TW 叫「存取碼」（C17 / lane X），「訪問碼」是大陆用法；
  // macOS 权限名按台湾系统设置：「完整磁碟取用權限」「輔助使用」
  'zh-TW': [/外掛廣場/, /外掛中心/, /包青天/, /后/, /^回傳$/, /(?<![合一])併(?![入購])/, /懶人模式/, /Skill/, /Plugin/, /訪問碼/, /完全磁碟/, /磁碟訪問/, /訪問權限/],
  'en-US': [/Plugin Marketplace/, /^Extensions$/, /\bLog ?[Ii]n\b/, /\bLog ?[Oo]ut\b/, /^Login$/, /Lazy Mode/i, /^Sign (in|out)$/],
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

// 官方插件的构建产物内嵌整套工作台 locale：源码改了没重建，旧品牌写法会随插件发出去（POLISH X22）。
const pluginsRoot = path.resolve(process.cwd(), '../official-plugins')
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })
for (const id of readdirSync(pluginsRoot)) {
  const web = path.join(pluginsRoot, id, 'web')
  try { statSync(web) } catch { continue }
  for (const file of walk(web).filter((f) => /\.(js|html)$/.test(f))) {
    if (readFileSync(file, 'utf8').includes('包青天')) {
      console.error(`✗ ${path.relative(pluginsRoot, file)}: 插件产物含「包青天」，请 npm run build:plugins 重建`)
      failed++
    }
  }
}

if (failed) {
  console.error(`check-terminology: ${failed} 处旧术语，按 docs/i18n/glossary.json 改。`)
  process.exit(1)
}
console.log('✓ check-terminology: 插件市场 / 包晴天 / zh-TW 用字一致')
