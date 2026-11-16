// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 反馈入口从「全局可拖动浮窗」改成「左栏 rail 底部固定图标」（dev-board#755）。
//
// 维护者拍板：「整个界面浮球太多、看起来非常混乱」——画布只留 AI 审校一颗，
// 反馈收进左栏 rail，全局不再有浮球。这里做源码级断言：浮钮与拖动一行都不许回来，
// 入口与面板落点各自钉死。真渲染走查另见汇报里的截图。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
// 注释里说得出「撤掉了什么」是好事，断言只看真代码
const cutBetween = (str, open, close) => {
  let out = str, i = out.indexOf(open)
  while (i !== -1) {
    const j = out.indexOf(close, i + open.length)
    out = j === -1 ? out.slice(0, i) : out.slice(0, i) + out.slice(j + close.length)
    i = out.indexOf(open)
  }
  return out
}
const stripComments = (s) =>
  cutBetween(cutBetween(s, '<!--', '-->'), '/*', '*/').replace(/^\s*\/\/.*$/gm, '')

const WIDGET = read('components/FeedbackWidget.vue')
const MOUNT = read('utils/feedbackWidget.js')
const WORKBENCH = read('pages/project-overview/project-overview.vue')
const PROJECT_LIST = read('pages/project-list/project-list.vue')
const LAUNCH = read('pages/launch/launch.vue')
const ICONS = read('config/icons.js')

test('FeedbackWidget 不再有浮钮：没有 .awdfb-launcher，没有拖动处理器', () => {
  assert.ok(!WIDGET.includes('awdfb-launcher'), '浮钮已撤，.awdfb-launcher 不许再出现')
  for (const token of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.ok(!WIDGET.includes(token), `拖动处理器残留：${token}`)
  }
  for (const token of ['onLauncherDown', 'onLauncherMove', 'onLauncherUp', 'detachLauncherDrag', 'clampPos', 'launcherSize']) {
    assert.ok(!WIDGET.includes(token), `拖动方法残留：${token}`)
  }
})

test('FeedbackWidget 不再持久化入口位置，也不再有让路机制', () => {
  assert.ok(!WIDGET.includes('awd_feedback_launcher_pos'), '入口位置的持久化键必须一并删掉')
  assert.ok(!WIDGET.includes('launcherPos'), 'launcherPos 残留')
  assert.ok(!stripComments(WIDGET).includes('keepClear'), '浮钮让路（keepClear）随浮钮一起撤')
  assert.ok(!existsSync(join(SRC, 'utils/keepClear.js')),
    'utils/keepClear.js 只为浮钮避开主操作区而存在，浮钮撤了它就是死代码')
})

test('反馈面板固定在窗口左下（挨着 rail），不再跟着入口象限跑', () => {
  assert.ok(!WIDGET.includes('panelStyle'), '面板不再按入口象限算落点，panelStyle 应删掉')
  const css = WIDGET.slice(WIDGET.indexOf('.awdfb-panel {'))
  const rule = css.slice(0, css.indexOf('}'))
  assert.match(rule, /left:/, '面板落点贴左：入口在左栏 rail 底部，面板从右下角冒出来对不上')
  assert.ok(!/\bright:/.test(rule), '面板不再贴右缘')
  assert.match(rule, /bottom:/, '面板贴底（让开工作台底部 26px 状态条）')
})

test('打开浮窗的唯一通道仍是 awd:open-feedback 事件', () => {
  // 浮窗是 body 级单例（feedbackWidget.js），页面组件够不到它的实例，只能走事件
  assert.match(WIDGET, /uni\.\$on\('awd:open-feedback'/, '浮窗必须继续订阅这个事件')
  assert.match(WIDGET, /uni\.\$off\('awd:open-feedback'/, '卸载时要摘掉监听')
  assert.match(MOUNT, /export function openFeedbackWidget/, '入口方的唯一出口')
  const fn = MOUNT.slice(MOUNT.indexOf('export function openFeedbackWidget'))
  assert.match(fn, /uni\.\$emit\('awd:open-feedback'\)/, 'openFeedbackWidget 必须发这个事件')
})

test('工作台 rail 固定底部有反馈按钮（与暂存区/版本记录同一簇）', () => {
  const rail = WORKBENCH.slice(WORKBENCH.indexOf('<view class="left-rail"'))
  const railEnd = rail.indexOf('<!-- File Picker Dialog')
  assert.ok(railEnd > 0, '找不到 rail 段落的结尾')
  const body = rail.slice(0, railEnd)
  assert.match(body, /@tap="openFeedback"/, 'rail 里要有反馈按钮')
  assert.match(body, /GLYPHS\.feedback/, '反馈按钮用内联 SVG 图标（禁 emoji）')
  const footerAt = body.indexOf('class="rail-footer"')
  assert.ok(footerAt > 0 && body.indexOf('@tap="openFeedback"') > footerAt, '反馈按钮在固定底部区')
  assert.match(WORKBENCH, /openFeedback\s*\(\)\s*\{[^}]*openFeedbackWidget\(\)/,
    '工作台的 openFeedback 走 utils/feedbackWidget.js 的统一出口')
})

// 2026-09-29（dev-board#1047）：启动落点从项目列表页换成工作台外壳（有 rail），项目列表页
// 退成直链薄壳、进来即转到工作台——「启动落点不能没有反馈入口」这条由工作台 rail 兜住。
test('启动落点是工作台外壳（rail 底部有反馈入口），项目列表页只是转过去的薄壳', () => {
  assert.match(LAUNCH, /uni\.reLaunch\(\{ url: '\/pages\/project-overview\/project-overview' \}\)/,
    '启动落工作台外壳')
  assert.match(PROJECT_LIST, /\/pages\/project-overview\/project-overview\?pane=projects/,
    '项目列表页转到工作台外壳并打开「项目」面板')
  assert.match(WORKBENCH, /@tap="openFeedback"/, '工作台 rail 上有反馈入口')
})

test('反馈图标进 config/icons.js（唯一图标出处）', () => {
  assert.match(ICONS, /^\s*feedback:\s*\[/m, 'ICONS.feedback 缺失')
})

function loadMineFormatters(locale) {
  const start = WIDGET.indexOf('const MINE_STATUS_LABELS = {')
  const end = WIDGET.indexOf('\nexport default {', start)
  assert.ok(start >= 0 && end > start, '找不到我的反馈格式化函数')
  const messages = new Function(read(`locales/${locale}/feedback.js`).replace('export default', 'return'))()
  const translate = (key, params = {}) => {
    const template = messages[key.replace(/^feedback\./, '')]
    assert.equal(typeof template, 'string', `${locale} 缺少词条 ${key}`)
    return template.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match))
  }
  return new Function('t$', `${WIDGET.slice(start, end)}\nreturn { formatMineItem }`)(translate)
}

test('我的反馈把 RESOLVED 显示为已解决，不再落入处理中', () => {
  const { formatMineItem } = loadMineFormatters('zh-CN')
  const item = formatMineItem({ id: 'resolved', kind: 'BUG', text: '正文', status: 'RESOLVED' })
  assert.equal(item.statusLabel, '已解决')
  assert.notEqual(item.statusLabel, '处理中')
})

test('我的反馈保留公开答复正文并格式化发布时间', () => {
  const { formatMineItem } = loadMineFormatters('zh-CN')
  const item = formatMineItem({
    id: 'answered', kind: 'BUG', text: '正文', status: 'RESOLVED',
    reporterResponse: '  已修复，重启后再试。\n感谢反馈。  ',
    responsePublishedAt: '2026-11-09T08:30:00Z',
  })
  assert.equal(item.reporterResponse, '已修复，重启后再试。\n感谢反馈。')
  assert.match(item.responseTimeLabel, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.match(WIDGET, /<div class="awdfb-mine-response-text">\{\{ item\.reporterResponse \}\}<\/div>/)
  assert.match(WIDGET, /\$t\('feedback\.responsePublishedAt', \{ time: item\.responseTimeLabel \}\)/)
})

test('我的反馈没有公开答复或只有空白时不渲染答复区', () => {
  const { formatMineItem } = loadMineFormatters('zh-CN')
  for (const reporterResponse of [undefined, null, '', '  \n  ']) {
    const item = formatMineItem({ id: 'unanswered', kind: 'BUG', text: '正文', status: 'RESOLVED', reporterResponse })
    assert.equal(item.reporterResponse, '')
  }
  assert.match(WIDGET, /<div v-if="item\.reporterResponse" class="awdfb-mine-response">/)
})

test('我的反馈保留 NEW 的待发送与已送达状态', () => {
  const { formatMineItem } = loadMineFormatters('zh-CN')
  const base = { id: 'new', kind: 'BUG', text: '正文', status: 'NEW' }
  assert.equal(formatMineItem({ ...base, uploaded: false }).statusLabel, '待发送')
  assert.equal(formatMineItem({ ...base, uploaded: true }).statusLabel, '已送达，排队处理中')
})
