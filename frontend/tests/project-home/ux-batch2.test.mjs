// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// UX 走查第二批回归断言：左 rail 文字标签、AI 面板空态工作流卡片、历史行「⋯」、
// 设置分区归位与改名、整理图标入口。源码文本断言，口径同 ux-navigation-clarity.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL('../../src/' + rel, import.meta.url), 'utf8')
const host = read('pages/project-overview/project-overview.vue')
const chat = read('components/ChatInterface.vue')
const admin = read('components/admin/AdminPane.vue')
const LOCALES = 'ar-SA de-DE el-GR en-US es-ES fr-FR hi-IN id-ID it-IT ja-JP ko-KR ms-MY nl-NL pt-BR ru-RU th-TH tr-TR vi-VN zh-CN zh-TW'.split(' ')
const localeText = (loc, ns) => read(`locales/${loc}/${ns}.js`)

test('1 rail：每个图标下有文字标签，底部三项也有；无项目态不上「客户协作」', () => {
  const rail = host.slice(host.indexOf('<view class="left-rail"'), host.indexOf('<FilePickerDialog'))
  assert.match(rail, /<text class="rail-label">\{\{ railLabelOf\(p\) \}\}<\/text>/)
  for (const k of ['railLabelStaging', 'railLabelVersion', 'railLabelFeedback']) {
    assert.ok(rail.includes(`$t('workbench.${k}')`), k)
  }
  assert.match(host, /p\.key !== 'dd-client' && isPaneAllowedWithoutProject\(p\.key\)/)
  const sort = read('pages/project-overview/railSort.js')
  for (const k of ['railLabelHome', 'railLabelClient', 'railLabelFiles', 'railLabelPlugins', 'railLabelDev']) {
    assert.ok(sort.includes(`workbench.${k}`), k)
  }
  assert.match(read('pages/project-overview/project-overview.scss'), /\.left-rail \{\s*width: 56px;/)
  assert.match(read('pages/project-overview/panelDocking.js'), /const RAIL = 56/)
})

test('1 rail 短标签在 20 个语言里都有', () => {
  for (const loc of LOCALES) {
    const t = localeText(loc, 'workbench')
    for (const k of ['railLabelHome', 'railLabelClient', 'railLabelFiles', 'railLabelPlugins', 'railLabelDev',
      'railLabelStaging', 'railLabelVersion', 'railLabelFeedback', 'railEditDoneBtn', 'railEditMenuItem', 'conversationMore']) {
      assert.match(t, new RegExp(`"?${k}"?: `), `${loc} ${k}`)
    }
  }
})

test('2 AI 面板空态：四个内置工作流卡片直接在输入框下，且不再藏在空态的高级设置里', () => {
  const empty = chat.slice(chat.indexOf('class="empty-workflows"'), chat.indexOf('<!-- 4. Regular Bottom Input -->'))
  assert.match(empty, /v-for="bw in builtinQuickWorkflows"[\s\S]{0,200}empty-workflow-card/)
  assert.match(empty, /@tap="applyBuiltinWorkflow\(bw\)"/)
  assert.match(empty, /openBuiltinWorkflowEditor\(/)
  assert.ok(!empty.includes('builtin-workflows-fold'), '空态高级设置里不再重复一份折叠的工作流')
  // 卡片在「高级设置」之前
  assert.ok(chat.indexOf('class="empty-workflows"') < chat.indexOf('class="composer-advanced-settings"'))
})

test('2 「Jev」不再作为功能名出现在界面文案里（数据去向披露除外）', () => {
  for (const loc of LOCALES) {
    const t = localeText(loc, 'chat')
    const entry = t.split('\n').find((l) => /decisionAssistEntry/.test(l))
    assert.ok(entry && !/Jev/.test(entry), `${loc}: ${entry}`)
  }
  assert.match(localeText('zh-CN', 'chat'), /decisionAssistEntry: '了解并使用智能决策辅助（实验）'/)
})

test('3 历史对话行：常驻「⋯」菜单，近期对话有「全部 ›」', () => {
  assert.match(host, /class="conv-more"[^>]*@tap\.stop="openConvMenu\(chat, \$event\)"/)
  for (const a of ["runConvMenu('rename')", "runConvMenu('pin')", "runConvMenu('delete')"]) assert.ok(host.includes(a), a)
  assert.ok(!host.includes('class="conv-actions"'), '悬停才出的三个文字操作已撤')
  const scss = read('pages/project-overview/project-overview.scss')
  const more = scss.slice(scss.indexOf('.conv-more {'), scss.indexOf('.conv-more:hover'))
  assert.ok(!/opacity:\s*0;/.test(more), '「⋯」不能是 opacity:0')
  assert.match(chat, /recent-history-all[^>]*@tap="\$emit\('toggle-history'\)"[^>]*>\{\{ \$t\('chat\.recentChatsAll'\) \}\}/)
})

test('4 设置：扫描件识别在 AI 功能设置，隐私项归并到「隐私与数据」，新分组「我的工作」垫底', () => {
  const sec = (nav) => {
    const at = admin.indexOf(`activeNav === '${nav}'`)
    assert.ok(at > 0, nav)
    const next = admin.indexOf('<scroll-view', at + 20)
    return admin.slice(at, next)
  }
  const ai = sec('ai')
  assert.match(ai, /<OcrRoutingSettings/)
  assert.ok(!sec('account').includes('<OcrRoutingSettings'))
  assert.ok(!ai.includes('consent-box'), '跨境同意已搬出 AI 分区')
  const priv = sec('telemetry')
  assert.ok(priv.includes('toggleCrossBorderConsent'))
  assert.ok(priv.includes('onToggleTelemetry'))
  assert.ok(priv.includes('<DocGeneratorSetting'))
  assert.ok(!read('components/userprofile/PersonalSettingsPanel.vue').includes('docGenerator'))
  // 分组：个人 / 系统 / 我的工作（最后）；四个「我的」栏目在 mywork，id 不变
  assert.match(admin, /\{ key: 'personal', label[\s\S]*\{ key: 'system', label[\s\S]*\{ key: 'mywork', label: this\.\$t\('admin\.navGroupMyWork'\) \}/)
  for (const k of ['work_log', 'case_intake', 'favorites', 'todos']) {
    assert.match(admin, new RegExp(`key: '${k}'[^\\n]*group: 'mywork'`), k)
    assert.ok(admin.includes(`activeNav === '${k}'`), `${k} 的 id 与面板分支保留`)
  }
  assert.match(admin, /key: 'telemetry'[^\n]*group: 'personal'/)
})

test('4 设置改名：隐私与数据 / 外部工具连接（MCP） / 后台任务模型', () => {
  assert.match(localeText('zh-CN', 'admin'), /navTelemetry: '隐私与数据'/)
  assert.match(localeText('zh-CN', 'admin'), /subagentModelLabel: '后台任务模型'/)
  assert.match(localeText('zh-CN', 'admin'), /navGroupMyWork: '我的工作'/)
  assert.match(localeText('zh-CN', 'mcp'), /"title": "外部工具连接（MCP）"/)
  assert.match(localeText('en-US', 'admin'), /navTelemetry: 'Privacy & data'/)
  for (const loc of LOCALES) {
    assert.match(localeText(loc, 'admin'), /"?navGroupMyWork"?: /, loc)
    assert.match(localeText(loc, 'admin'), /"?telemetrySectionTitle"?: /, loc)
  }
})

test('5 整理图标：顶栏按钮已撤，入口在 rail 右键菜单，整理中 rail 顶部有「完成」', () => {
  const header = host.slice(host.indexOf('<view class="header-right">'), host.indexOf('<!-- 主体布局 -->'))
  assert.ok(!header.includes('toggleRailEditMode'), '顶栏不再有整理开关')
  assert.match(host, /<view class="left-rail" @contextmenu="openRailMenu\(\$event\)">/)
  assert.match(host, /v-if="railEditMode" class="rail-edit-done"[^>]*@tap="toggleRailEditMode"[^>]*>\{\{ \$t\('workbench\.railEditDoneBtn'\) \}\}/)
  assert.match(host, /v-if="dockMenu\.rail"[\s\S]{0,200}startRailEditFromMenu[\s\S]{0,120}workbench\.railEditMenuItem/)
  const dock = read('pages/project-overview/panelDocking.js')
  assert.match(dock, /openRailMenu\(evt\)/)
  assert.match(dock, /startRailEditFromMenu\(\)/)
})

test('6 其余语言的散文不再引用旧名称（账户与用量 / 账户与安全 / 系统设置）', () => {
  const old = {
    'de-DE': ['Konto & Nutzung', 'Konto & Sicherheit', 'Systemeinstellungen - '],
    'fr-FR': ['Compte et utilisation', 'Paramètres système'],
    'ja-JP': ['アカウントと使用状況', 'アカウントと利用状況', 'システム管理'],
    'ko-KR': ['계정 및 사용량', '시스템 설정 -'],
    'ru-RU': ['Аккаунт и использование', 'Системные настройки'],
    'zh-TW': ['賬戶與用量', '帳戶與用量'],
    'en-US': ['Account & Usage', 'Account & usage', 'System settings'],
  }
  for (const [loc, terms] of Object.entries(old)) {
    for (const ns of ['market', 'meeting', 'files', 'onboarding', 'team', 'workbenchOps']) {
      const t = localeText(loc, ns)
      for (const term of terms) assert.ok(!t.includes(term), `${loc}/${ns}: ${term}`)
    }
  }
})
