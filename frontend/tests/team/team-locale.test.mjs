// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// team 命名空间的文案红线（dev-board#496）：两语言键集合一致、禁 emoji、
// 中文不许含 api.js 历史上用来判掉线的三个子串。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const load = async (lang) =>
  (await import(resolve(root, `src/locales/${lang}/team.js`))).default

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => {
    const full = prefix ? `${prefix}.${k}` : k
    return v && typeof v === 'object' ? flatten(v, full) : [full]
  })

const values = (obj) =>
  Object.values(obj).flatMap((v) => (v && typeof v === 'object' ? values(v) : [String(v)]))

test('zh-CN / en-US 的 team 命名空间键集合完全一致', async () => {
  const zh = flatten(await load('zh-CN')).sort()
  const en = flatten(await load('en-US')).sort()
  assert.deepEqual(zh, en)
})

test('中文文案不含「登录」「未授权」「请先」——api.js 曾拿这三个子串判掉线并清会话', async () => {
  const zh = await load('zh-CN')
  for (const [key, value] of Object.entries(zh)) {
    for (const needle of ['登录', '未授权', '请先']) {
      assert.ok(!String(value).includes(needle), `team.${key} 含掉线子串「${needle}」：${value}`)
    }
  }
})

test('两语言都不含 emoji（全站红线）', async () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
  for (const lang of ['zh-CN', 'en-US']) {
    for (const value of values(await load(lang))) {
      assert.ok(!emoji.test(value), `${lang} 文案含 emoji：${value}`)
    }
  }
})

test('「节约时间」的中英文案都带「估算 / estimated」，不做成看起来精确的数字', async () => {
  const zh = await load('zh-CN')
  const en = await load('en-US')
  assert.ok(zh.kpiSavedMinutes.includes('估算'), zh.kpiSavedMinutes)
  assert.ok(/estimat/i.test(en.kpiSavedMinutes), en.kpiSavedMinutes)
  assert.ok(zh.savedFormula.includes('分钟'), '中文脚注必须把公式摆出来')
})

test('项目名确认框的两个按钮都说清后果，拒绝那条给出真出路（C4）', async () => {
  const zh = await load('zh-CN')
  const en = await load('en-US')
  assert.ok(zh.projectNamesTitle.includes('项目名'), zh.projectNamesTitle)
  assert.ok(zh.projectNamesDecline.includes('匿名'), '拒绝按钮要说明「只传匿名编号」：' + zh.projectNamesDecline)
  assert.ok(/anonymous/i.test(en.projectNamesDecline), en.projectNamesDecline)
  // 待确认的说明要讲清「确认之前这段统计留在本机」，不然用户只看到看板一直是空的
  assert.ok(zh.projectNamesPendingDesc.includes('本机'), zh.projectNamesPendingDesc)
})

test('隐私一句话点明「不含文档内容/文件名/对话」', async () => {
  const zh = await load('zh-CN')
  for (const needle of ['文档内容', '文件名', '对话']) {
    assert.ok(zh.privacyLine.includes(needle), `隐私文案缺「${needle}」：${zh.privacyLine}`)
  }
})

test('隐私文案与项目名的实际上传条件一致：只有「共享开启 + 本机同意」才带项目名（QD-D6）', async () => {
  const zh = await load('zh-CN')
  const en = await load('en-US')
  for (const key of ['privacyLine', 'projectsNote', 'sharingDesc']) {
    assert.ok(zh[key].includes('匿名'), `${key} 要说清不满足条件时只传匿名编号：${zh[key]}`)
    assert.ok(!/^项目名随统计上传/.test(zh[key]), `${key} 不得无条件宣称项目名随统计上传：${zh[key]}`)
  }
  for (const key of ['privacyLine', 'projectsNote']) {
    assert.ok(zh[key].includes('同意'), `${key} 要点明需本机确认同意：${zh[key]}`)
    assert.ok(/consent|confirm/i.test(en[key]), en[key])
  }
  assert.ok(!/^Team stats upload counts and anonymous project codes only/.test(en.privacyLine))
})

test('周看板表头在周一看上周时跟着换成「上周」，不再写死「本周」（QD-D8）', async () => {
  const zh = await load('zh-CN')
  const board = readFileSync(new URL('../../src/components/admin/TeamWeekBoard.vue', import.meta.url), 'utf8')
  assert.equal(zh.weekColHoursLastWeek, '上周工时')
  assert.match(board, /week\.lastWeek \? 'team\.weekColHoursLastWeek' : 'team\.weekColHours'/)
})

test('周看板 KPI 格整格换行、表格整体横向滚动，侧栏挤窄时不挤压文字（QD-D7）', () => {
  const board = readFileSync(new URL('../../src/components/admin/TeamWeekBoard.vue', import.meta.url), 'utf8')
  assert.match(board, /grid-template-columns: repeat\(auto-fit, minmax\(150px, 1fr\)\)/)
  assert.doesNotMatch(board, /repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(board, /\.week-table \{[^}]*overflow-x: auto/)
  assert.match(board, /\.wcol-hours \{[^}]*white-space: nowrap/)
})
