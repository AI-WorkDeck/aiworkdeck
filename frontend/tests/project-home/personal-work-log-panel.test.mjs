// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// v0.49.0 真机测试批次 E：PersonalWorkLogPanel.vue 两条缺陷的回归断言。
//
// BUG-04（设置→工作记录，中文界面）：SettingsSection 头部默认布局是
// head-text（flex:1 + min-width:0）+ actions（flex-shrink:0）。本栏目的筛选行
// （日期/项目/关键词/导出 4 个控件）比其它分节的 actions 宽得多，中栏宽度下
// actions 占满自然宽度不收缩，标题区被挤到 0 附近，中文标题逐字竖排（英文界面
// 正常，因为拉丁字符更窄、没触发这种极端挤压）。这里做纯源码文本断言（真实
// flex 布局 jsdom 不计算，只能靠这个 + 人工截图核对）。
//
// BUG-45（工作记录「操作」列）：表格与 CSV 导出原来直接渲染后端枚举
// （OPEN_FILE/OPEN_URL/...），律师用户看不懂。这条抽出真实的 <script> 逐字执行，
// 断言映射函数真的接了线、且 zh-CN/en-US 两份文案都补齐。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const SRC = read('../../src/components/userprofile/PersonalWorkLogPanel.vue')
const TEMPLATE = SRC.slice(SRC.indexOf('<template>'), SRC.lastIndexOf('</template>'))
const STYLE = SRC.slice(SRC.lastIndexOf('<style'), SRC.lastIndexOf('</style>'))

/** 取某个 class 选择器名下所有规则体（scoped 里同名可能写多条）。与
 * editor-toolbar-layout.test.mjs 用的是同一个小工具，这里独立抄一份避免跨文件耦合。 */
function rulesFor(selectorFragment) {
  const out = []
  const escaped = selectorFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'g')
  let m
  while ((m = re.exec(STYLE))) out.push(m[1])
  return out
}
const declares = (selectorFragment, prop, value) =>
  rulesFor(selectorFragment).some((body) => new RegExp(prop + '\\s*:\\s*' + value).test(body))

// ---------- BUG-04：标题区不许被挤到 0 ----------

test('BUG-04: 头部换深选择器允许整行换行，筛选行挤不下时掉到第二行', () => {
  assert.ok(
    declares(':deep(.awd-set-section-head)', 'flex-wrap', 'wrap'),
    '.panel-work-log 必须用 :deep 覆盖 SettingsSection 头部的 flex-wrap，否则筛选行永远和标题区挤同一行',
  )
})

test('BUG-04: 标题区有一个不为 0 的下限宽度，不会被压成逐字竖排', () => {
  const bodies = rulesFor(':deep(.awd-set-section-head-text)')
  assert.ok(bodies.length > 0, '找不到覆盖 .awd-set-section-head-text 的规则')
  const minWidths = bodies
    .map((b) => /min-width\s*:\s*(\d+)px/.exec(b))
    .filter(Boolean)
    .map((m) => Number(m[1]))
  assert.ok(minWidths.length > 0, '必须显式设置 min-width（覆盖 SettingsSection 默认的 min-width:0）')
  assert.ok(minWidths.every((w) => w > 0), 'min-width 必须大于 0，否则和上游默认值一样还是会被挤没')
})

// ---------- BUG-04 复核缺口：折行后 actions 容器本身也要能收缩 ----------
// 复核者实测：右栏开着、区块约 410px 宽时，筛选行折到第二行后 actions 容器
// （SettingsSection 共用的 .awd-set-section-actions）仍是 flex-shrink:0 +
// 自然宽度（约 517px），超出区块约 122px 被 .awd-set-section 的 overflow:hidden
// 裁掉，导出按钮和关键词输入框一部分看不见点不到（修复前也如此，不是回归）。

test('BUG-04 复核缺口: actions 容器可收缩到区块宽度内，不再撑出自然宽度', () => {
  assert.ok(
    declares(':deep(.awd-set-section-actions)', 'flex-shrink', '1'),
    '.awd-set-section-actions 必须覆盖 SettingsSection 默认的 flex-shrink:0，否则折行后仍按自然宽度撑爆容器',
  )
  assert.ok(
    declares(':deep(.awd-set-section-actions)', 'min-width', '0'),
    '.awd-set-section-actions 必须 min-width:0，否则 flex-shrink:1 收缩不到位（flex 子项默认 min-width:auto）',
  )
  assert.ok(
    declares(':deep(.awd-set-section-actions)', 'max-width', '100%'),
    '.awd-set-section-actions 必须 max-width:100%，把它钉死在区块宽度以内',
  )
})

test('BUG-04 复核缺口: 筛选行本身允许再换行，容器变窄时控件掉到下一行而不是被裁掉', () => {
  assert.ok(
    declares('.log-filter-bar', 'flex-wrap', 'wrap'),
    '.log-filter-bar 必须 flex-wrap:wrap，否则 actions 容器收缩后 4 个控件挤不下也不会换行，只会被压扁或溢出',
  )
})

test('BUG-04 复核缺口: 关键词输入框与项目下拉都能收缩到 0，不被内容撑住', () => {
  assert.ok(
    declares('.filter-input', 'min-width', '0'),
    '.filter-input 必须 min-width:0，否则 flex:1 收缩不到位（input 有内建 min-width:auto）',
  )
  assert.ok(
    declares('.filter-project-select', 'min-width', '0'),
    '.filter-project-select 必须 min-width:0，否则项目下拉也会阻止 actions 容器收缩',
  )
})

test('BUG-04 复核缺口: 导出按钮保持 flex-shrink:0，折行后仍是完整可点的按钮', () => {
  assert.ok(
    declares('.btn-export', 'flex-shrink', '0'),
    '.btn-export 必须保持 flex-shrink:0，否则收缩时按钮本身被压扁，文字放不下也点不准',
  )
})

// ---------- BUG-45：操作列不许直接吐后端枚举 ----------

/** 把组件 <script> 抽出来，剥掉 import，当函数体跑；只测纯函数部分（不依赖 uni/网络）。 */
function makeVm() {
  const script = SRC.slice(SRC.indexOf('<script>') + 8, SRC.indexOf('</script>'))
  const importRe = /import\s*\{([\s\S]*?)\}\s*from\s*'[^']+'\s*;?/g
  const defaultImportRe = /import\s+([A-Za-z_$][\w$]*)\s+from\s*'[^']+'\s*;?/g
  const locals = []
  let m
  while ((m = importRe.exec(script)) !== null) {
    for (const part of m[1].split(',')) {
      const t = part.trim()
      if (t) locals.push(t)
    }
  }
  while ((m = defaultImportRe.exec(script)) !== null) locals.push(m[1])
  const preamble = locals
    .map((n) => `const ${n} = () => { throw new Error('未打桩: ${n}') };`)
    .join('\n')
  const body = script.replace(importRe, '').replace(defaultImportRe, '').replace('export default', 'return')
  // eslint-disable-next-line no-new-func
  const component = new Function(preamble + '\n' + body)()
  const base = { $t: (k) => k }
  return Object.assign(base, component.data.call(base), component.methods)
}

test('BUG-45: 模板不再直接插值 log.actionType，走映射函数', () => {
  assert.doesNotMatch(TEMPLATE, /\{\{\s*log\.actionType\s*\}\}/,
    '「操作」列必须调映射函数，不能再原样吐后端枚举')
  assert.match(TEMPLATE, /getLogActionLabel\(log\)/, '模板里必须能找到 getLogActionLabel(log) 的调用')
})

test('BUG-45: getLogActionLabel 把已知枚举都映射成 i18n key，未知值原样兜底（不吞信息）', () => {
  const vm = makeVm()
  assert.equal(vm.getLogActionLabel({ actionType: 'OPEN_FILE' }), 'account.actionOpenFile')
  assert.equal(vm.getLogActionLabel({ actionType: 'OPEN_URL' }), 'account.actionOpenUrl')
  assert.equal(vm.getLogActionLabel({ actionType: 'WORK' }), 'account.actionWork')
  assert.equal(vm.getLogActionLabel({ actionType: 'CLOSE_FILE' }), 'account.actionCloseFile')
  assert.equal(vm.getLogActionLabel({ actionType: 'LOGIN' }), 'account.actionLogin')
  assert.equal(vm.getLogActionLabel({ actionType: 'PAGE_VIEW' }), 'account.actionPageView')
  assert.equal(vm.getLogActionLabel({ actionType: 'CLOSE_URL' }), 'account.actionCloseUrl')
  // 未来后端加了新枚举、前端还没跟上翻译时，别把这条记录的操作显示成空白
  assert.equal(vm.getLogActionLabel({ actionType: 'SOME_FUTURE_TYPE' }), 'SOME_FUTURE_TYPE')
})

test('BUG-45: CSV 导出也走同一套映射，不是模板改了导出漏了', () => {
  const start = SRC.indexOf('exportLogsToExcel()')
  assert.ok(start > 0, '找不到 exportLogsToExcel')
  const end = SRC.indexOf('formatTime(timeStr)', start)
  const body = SRC.slice(start, end > 0 ? end : start + 2000)
  assert.doesNotMatch(body, /const action = log\.actionType/,
    'CSV 导出必须也用 getLogActionLabel，不能只改模板漏了导出（导出文件是给人看/交接用的）')
  assert.match(body, /getLogActionLabel\(log\)/)
})

test('BUG-45: zh-CN 与 en-US 两份文案同步补齐，不是只改了一边', () => {
  const zh = read('../../src/locales/zh-CN/account.js')
  const en = read('../../src/locales/en-US/account.js')
  const keys = ['actionLogin', 'actionOpenFile', 'actionCloseFile', 'actionPageView', 'actionOpenUrl', 'actionCloseUrl', 'actionWork']
  for (const k of keys) {
    assert.match(zh, new RegExp(`\\b${k}\\s*:`), `zh-CN/account.js 缺 ${k}`)
    assert.match(en, new RegExp(`\\b${k}\\s*:`), `en-US/account.js 缺 ${k}`)
  }
})

// ---------- dev-board#1713：时长显示、关键词、CSV、空闲段（问题 111/55/56/57/51） ----------

function makeVmWithParams() {
  const vm = makeVm()
  vm.$t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k)
  return vm
}

test('111: 时长显示成「x 小时 y 分」/「y 分」/「不足 1 分钟」，不再是 15 秒取整的小数分钟', () => {
  const vm = makeVmWithParams()
  assert.equal(vm.getLogDuration({ duration: 15 * 1000 }), 'account.durationUnderMinute')
  assert.equal(vm.getLogDuration({ duration: 7 * 60 * 1000 + 40 * 1000 }), 'account.durationMinutes:{"minutes":7}')
  assert.equal(vm.getLogDuration({ duration: (2 * 60 + 5) * 60 * 1000 }), 'account.durationHoursMinutes:{"hours":2,"minutes":5}')
  assert.doesNotMatch(SRC, /Math\.ceil\(seconds \/ 15\)/)
})

test('55: 关键词同时匹配对象列与项目名，忽略大小写', () => {
  const vm = makeVm()
  vm.activityLogs = [
    { id: 1, actionType: 'OPEN_FILE', targetName: '股权转让协议.DOCX', projectId: 1, projectName: '甲项目', metaInfo: 'Project: 甲项目' },
    { id: 2, actionType: 'OPEN_URL', targetName: 'https://Example.com/a', projectId: 2, projectName: 'Alpha 并购', metaInfo: '' },
  ]
  vm.projectFilterKey = 'all'
  vm.activityFilter.content = '.docx'
  assert.deepEqual(vm.getFilteredLogs().map(l => l.id), [1])
  vm.activityFilter.content = 'alpha'
  assert.deepEqual(vm.getFilteredLogs().map(l => l.id), [2])
  vm.activityFilter.content = 'example.COM'
  assert.deepEqual(vm.getFilteredLogs().map(l => l.id), [2])
})

test('56: CSV 标准转义（双引号包裹、内部 " 加倍），# 与逗号原样保留，带 BOM', () => {
  const vm = makeVm()
  const csv = vm.buildLogsCsv([
    { id: 1, actionType: 'OPEN_FILE', targetName: '方案#2, "终稿".docx', projectId: 1, projectName: 'A', duration: 0, timestamp: '2026-11-01T10:00:00' },
  ])
  assert.ok(csv.startsWith('﻿'))
  assert.match(csv, /"方案#2, ""终稿""\.docx"/)
  assert.equal(csv.trim().split('\r\n').length, 2)
})

test('56/57: 导出走 Blob + createObjectURL，文件名用本地日期，不再用 data: URI / toISOString', () => {
  const start = SRC.indexOf('exportLogsToExcel()')
  const body = SRC.slice(start, SRC.indexOf('formatTime(timeStr)', start))
  assert.match(body, /new Blob\(/)
  assert.match(body, /URL\.createObjectURL/)
  assert.doesNotMatch(body, /data:text\/csv/)
  assert.doesNotMatch(body, /toISOString/)
})

test('51: 空闲段按 activityTracker 写的毫秒格式解析，开始时间把空闲加回去', () => {
  const vm = makeVmWithParams()
  const start = new Date(2026, 10, 3, 9, 0, 0).getTime()
  const idleStart = start + 10 * 60000
  const idleEnd = start + 25 * 60000
  const end = start + 40 * 60000
  const log = {
    actionType: 'OPEN_FILE', duration: 25 * 60000, timestamp: new Date(end).toISOString(),
    metaInfo: `Project: A. IdleSegments: ${idleStart}-${idleEnd}`,
  }
  assert.equal(vm.getLogIdleTime(log), '09:10-09:25 (account.durationMinutes:{"minutes":15})')
  assert.equal(vm.getLogStartTime(log), vm.formatDateTime(new Date(start)))
})

test('57/111: 中英文案补齐（导出 CSV、时长格式、截断提示）', () => {
  const zh = read('../../src/locales/zh-CN/account.js')
  const en = read('../../src/locales/en-US/account.js')
  assert.match(zh, /exportExcelBtn:\s*'导出 CSV'/)
  for (const k of ['durationUnderMinute', 'durationMinutes', 'durationHoursMinutes', 'workLogTruncatedHint']) {
    assert.match(zh, new RegExp(`\\b${k}\\s*:`), `zh-CN 缺 ${k}`)
    assert.match(en, new RegExp(`\\b${k}\\s*:`), `en-US 缺 ${k}`)
  }
})
