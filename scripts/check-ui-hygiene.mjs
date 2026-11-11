// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 界面「静默失效」守卫（2026-11 版式排查后加）。这几类错误浏览器不报错、测试不红，
// 界面只是悄悄变丑：
//   1. 引用了宿主不存在的 --awd-* 令牌：整条声明失效，或永远走兜底值、深色主题不跟随。
//      范围：宿主前端、官方插件 web/、SDK 样式。
//   2. 官方插件 / SDK 里的 var(--awd-*) 没带兜底值：老宿主或独立预览下直接失效。
//   3. .vue 模板里某元素的静态类名一个都没有样式（团队看板 scope-tab 曾因此渲染成三行裸大字）。
//      已存在的记在 scripts/ui-hygiene-baseline.json，只拦新增；修好后从基线里删掉。
// 用法：node scripts/check-ui-hygiene.mjs [--update-baseline]
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(root, 'scripts/ui-hygiene-baseline.json')

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const p = join(dir, name)
    statSync(p).isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}
const read = p => readFileSync(p, 'utf8')
const rel = p => relative(root, p)
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:'"\w])\/\/[^\n]*/g, '$1')

const frontend = walk(join(root, 'frontend/src')).filter(p => /\.(vue|scss|css|js|html)$/.test(p))
// 官方插件只查手写源码：web/assets/ 是从 frontend 构建出来的产物，awd-plugin-sdk.js 是 SDK 的逐字副本
const plugins = walk(join(root, 'official-plugins'))
  .filter(p => /\/web\//.test(p) && /\.(css|html|js)$/.test(p) && !/\/web\/assets\//.test(p) && !p.endsWith('/awd-plugin-sdk.js'))
const sdk = ['sdk/plugin-sdk/awd-plugin-ui.css', 'sdk/plugin-sdk/awd-plugin-sdk.js'].map(p => join(root, p))

// 宿主令牌：前端任何地方定义过的（CSS 声明，或 appTheme.js 里 '--awd-x': 值 这种 JS 写法）
const hostTokens = new Set()
for (const p of frontend) for (const m of read(p).matchAll(/['"]?(--awd-[\w-]*\w)['"]?\s*:/g)) hostTokens.add(m[1])

export function tokenFailures() {
  const failures = []
  for (const p of [...frontend, ...plugins, ...sdk]) {
    const src = stripComments(read(p))
    const local = new Set([...src.matchAll(/(--awd-[\w-]*\w)\s*:/g)].map(m => m[1]))
    const needsFallback = !frontend.includes(p)
    for (const m of src.matchAll(/var\(\s*(--awd-[\w-]*\w)(-?)\s*(,)?/g)) {
      if (m[2]) continue // 模板拼接的前缀，如 --awd-titlebar-safe-${side}
      const name = m[1]
      if (!hostTokens.has(name) && !local.has(name)) failures.push(`${rel(p)}: 宿主没有令牌 ${name}`)
      else if (needsFallback && !m[3]) failures.push(`${rel(p)}: ${name} 缺兜底值（插件可能跑在老宿主/独立预览里）`)
    }
  }
  return [...new Set(failures)]
}

// ---------- 3. 没有任何样式的类名 ----------
const classSel = /\.(-?[_a-zA-Z][\w-]*)/g
const globalClasses = new Set()
const scopedByFile = new Map()
for (const p of frontend) {
  const src = read(p)
  if (p.endsWith('.vue')) {
    const local = new Set()
    for (const [, attrs, body] of src.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)) {
      const css = stripComments(body)
      const target = /\bscoped\b/.test(attrs) ? local : globalClasses
      for (const m of css.matchAll(classSel)) target.add(m[1])
      // 父组件用 :deep()/::v-deep 给子组件的类写样式：算全局
      for (const d of css.matchAll(/(?::deep|::v-deep|\/deep\/)\s*\(?([^{)]*)/g)) for (const m of d[1].matchAll(classSel)) globalClasses.add(m[1])
    }
    scopedByFile.set(p, local)
  } else if (/\.(s?css)$/.test(p)) {
    for (const m of stripComments(src).matchAll(classSel)) globalClasses.add(m[1])
  } else {
    // JS 里拼出来的样式字符串（如运行时注入的 <style>）
    for (const m of src.matchAll(/`([^`]*\{[^`]*\})`/g)) for (const c of m[1].matchAll(classSel)) globalClasses.add(c[1])
  }
}
// 第三方/框架自带的类前缀：样式不在本仓库里
const EXTERNAL = /^(uni-|iconfont|icon-|fa-|fas$|far$|fab$|ProseMirror|cm-|hljs|katex|tippy)/

export function unstyledElements() {
  const found = []
  for (const [p, local] of scopedByFile) {
    const template = read(p).match(/<template>([\s\S]*)<\/template>/)?.[1]
    if (!template) continue
    for (const m of stripComments(template).matchAll(/<[\w-]+\s[^>]*?(?<![:\w-])class="([^"]+)"/g)) {
      const classes = m[1].split(/\s+/).filter(c => c && !c.includes('{') && !EXTERNAL.test(c))
      if (!classes.length) continue
      if (classes.some(c => local.has(c) || globalClasses.has(c))) continue
      found.push(`${rel(p)}: ${classes.join(' ')}`)
    }
  }
  return [...new Set(found)].sort()
}

export function run(argv = process.argv.slice(2)) {
  const unstyled = unstyledElements()
  if (argv.includes('--update-baseline')) {
    writeFileSync(BASELINE, JSON.stringify(unstyled, null, 2) + '\n')
    console.log(`已写入基线：${unstyled.length} 条`)
    return 0
  }
  const baseline = new Set(existsSync(BASELINE) ? JSON.parse(read(BASELINE)) : [])
  const fresh = unstyled.filter(x => !baseline.has(x))
  const stale = [...baseline].filter(x => !unstyled.includes(x))
  const failures = [...tokenFailures(), ...fresh.map(x => `${x}  ← 这个元素的类名没有任何样式`)]
  if (stale.length) console.warn(`提示：基线里有 ${stale.length} 条已经不存在，可运行 --update-baseline 收紧：\n  ` + stale.join('\n  '))
  if (failures.length) {
    console.error(failures.join('\n'))
    console.error('\n见 sdk/plugin-sdk/UI-GUIDELINES.md。类名确实只做 JS/测试钩子的，在同文件写一条空规则或改用 data-* 属性。')
    return 1
  }
  console.log(`UI 守卫通过（令牌 ${hostTokens.size} 个；未设样式元素基线 ${baseline.size} 条）。`)
  return 0
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run()
