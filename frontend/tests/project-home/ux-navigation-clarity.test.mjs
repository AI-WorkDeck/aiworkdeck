// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// UX 走查（导航清晰度）回归断言：未登录设置入口、设置默认落点、菜单「账户与余额…」目标、
// 整页设置的返回出口、插件市场返回回落。源码文本断言，口径同本目录其它 source-assertions。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL('../../src/' + rel, import.meta.url), 'utf8')

test('未登录态在「登录」左侧有「设置」入口，复用 settings 事件', () => {
  const src = read('components/account/AccountEntry.vue')
  const tpl = src.slice(src.indexOf('<template>'), src.indexOf('</template>\n\n<script>'))
  const settingsAt = tpl.indexOf('signed-out-settings')
  const loginAt = tpl.indexOf("'header-login-btn'")
  assert.ok(settingsAt > 0 && loginAt > settingsAt, '设置入口必须在登录按钮之前（左侧）')
  assert.match(tpl, /v-if="!signedIn"[\s\S]{0,200}signed-out-settings[\s\S]{0,300}emitAndClose\('settings'\)/)
  assert.match(tpl, /signed-out-settings[\s\S]{0,500}workbench\.settingsTabName/)
})

test('设置页默认落「个人资料与登录」而不是工作记录', () => {
  const src = read('components/admin/AdminPane.vue')
  assert.ok(src.includes("activeNav: cachedIsAdmin() ? 'ai' : 'personal_settings'"))
  assert.ok(!src.includes("'ai' : 'work_log'"))
})

test('应用菜单「账户与余额…」落到 account 分区', () => {
  const cmd = read('config/commands/app.js')
  assert.match(cmd, /id: 'app\.account',[\s\S]{0,300}账户与余额…/)
  const bridge = read('utils/appMenuBridge.js')
  const body = bridge.slice(bridge.indexOf("case 'openAccount'"), bridge.indexOf("case 'logout'"))
  assert.match(body, /verb: 'openSettings', arg: 'account'/)
  assert.match(body, /\/pages\/admin\/admin\?nav=account/)
  assert.ok(!body.includes('pages/userprofile/userprofile'))
  const menu = read('pages/project-overview/menuCommands.js')
  assert.match(menu, /case 'openSettings': this\.openSettingsTab\(arg \? \{ nav: arg \} : \{\}\)/)
})

test('整页设置（非 embedded）带「返回工作台」，reLaunch 到工作台', () => {
  const src = read('components/admin/AdminPane.vue')
  assert.match(src, /v-if="!embedded"[^>]*class="nav-back"[^>]*@tap="goBackToWorkbench"/)
  assert.match(src, /goBackToWorkbench\(\) \{\s*uni\.reLaunch\(\{ url: '\/pages\/project-overview\/project-overview' \}\)/)
})

test('插件市场返回：没有历史栈或 navigateBack 失败时回工作台，不再落到 admin', () => {
  const src = read('components/MarketPane.vue')
  const body = src.slice(src.indexOf('goBack() {'), src.indexOf('goBack() {') + 700)
  assert.match(body, /getCurrentPages\(\)\.length <= 1/)
  assert.match(body, /navigateBack\(\{ fail: toWorkbench \}\)/)
  assert.ok(body.includes('/pages/project-overview/project-overview'))
  assert.ok(!body.includes('/pages/admin/admin'))
})

test('AI 面板历史下拉与模式下拉支持 Esc 收起', () => {
  const host = read('pages/project-overview/project-overview.vue')
  assert.match(host, /showHistoryDrawer\(open\) \{[\s\S]{0,500}e\.key === 'Escape'[\s\S]{0,120}showHistoryDrawer = false/)
  const chat = read('components/ChatInterface.vue')
  assert.match(chat, /dismissModeDropdown[\s\S]{0,200}showModeDropdown\.value = false/)
  assert.ok(chat.includes("window.addEventListener('keydown', dismissModeDropdown, true)"))
  assert.ok(chat.includes("window.removeEventListener('keydown', dismissModeDropdown, true)"))
})
