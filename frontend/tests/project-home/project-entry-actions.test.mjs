// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 工作台几个入口动作（dev-board#1713）：
//   问题 13：项目已打开时欢迎页提问 = 在本项目新建对话再发送，按钮如实叫「在本项目新建对话」；
//   问题 14：项目切换器下拉底部有「关闭项目」，走菜单同一条 file.closeProject（app:closeProject）；
//   问题 19：「转为正式项目」预填当前对话标题，取不到回落项目名，不再预填「临时项目」。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { promoteScratchDefaultName } from '../../src/pages/project-overview/chatMode.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const page = read('src/pages/project-overview/project-overview.vue')
const welcome = read('src/components/welcome/WelcomePane.vue')
const methodBody = (src, head) => {
  const i = src.indexOf(head)
  assert.ok(i >= 0, `找不到 ${head}`)
  return src.slice(i, src.indexOf('\n    },', i))
}

test('问题 13：有项目时欢迎页提问先在本项目新建对话，再发送', () => {
  const body = methodBody(page, 'async handleWelcomeStartChat(')
  assert.match(body, /const newChatInProject = this\.hasNamedProject/)
  const newChat = body.indexOf('this.handleChatSidebarNewChat()')
  assert.ok(newChat > 0, '没有新建对话')
  assert.ok(newChat < body.indexOf('sendQuickPrompt?.(prompt)'), '新建对话必须在发送之前')
  assert.match(body, /this\.restoredLastConversation = true/)
})

test('问题 13：欢迎页按钮与占位提示在有项目时改说「在本项目新建对话」', () => {
  assert.match(welcome, /currentProjectId != null \? 'workbench\.welcome\.newChatInProject' : 'workbench\.welcome\.enterChatMode'/)
  assert.match(welcome, /currentProjectId != null \? 'workbench\.welcome\.quickChatPlaceholderInProject' : 'workbench\.welcome\.quickChatPlaceholder'/)
})

test('问题 14：切换器下拉底部有「关闭项目」，执行 file.closeProject', () => {
  const menu = page.slice(page.indexOf('class="switcher-menu"'), page.indexOf('</view>\n            <view v-if="isScratchWorkspace"'))
  const all = menu.indexOf('switcher-all')
  const close = menu.indexOf('switcher-close')
  assert.ok(all > 0 && close > all, '「关闭项目」应在「全部项目…」之后、下拉最底部')
  assert.match(menu, /<view v-if="hasNamedProject" class="switcher-item switcher-close" @tap="closeProjectFromSwitcher">/)
  const body = methodBody(page, 'async closeProjectFromSwitcher()')
  assert.match(body, /this\.projectSwitcherOpen = false/)
  assert.match(body, /this\.runWelcomeCommand\('file\.closeProject'\)/, '先落盘再走菜单同一条命令')
  assert.match(read('src/config/commands/file.js'), /id: 'file\.closeProject',[\s\S]*?run: 'app:closeProject'/)
})

test('问题 19：转为正式项目的预填名', () => {
  assert.equal(promoteScratchDefaultName({ conversationTitle: '  股权转让协议审查 ', projectName: '临时项目' }), '股权转让协议审查')
  assert.equal(promoteScratchDefaultName({ conversationTitle: '', projectName: '临时项目' }), '')
  assert.equal(promoteScratchDefaultName({ conversationTitle: null, projectName: 'Temporary project' }), '')
  assert.equal(promoteScratchDefaultName({ conversationTitle: null, projectName: '臨時專案' }), '')
  assert.equal(promoteScratchDefaultName({ projectName: 'Projet temporaire', extraDefaultNames: ['Projet temporaire'] }), '')
  assert.equal(promoteScratchDefaultName({ projectName: '某某并购项目' }), '某某并购项目')
  const body = methodBody(page, 'async handlePromoteScratchWorkspace()')
  assert.match(body, /promoteScratchDefaultName\(\{/)
  assert.doesNotMatch(body, /this\.promoteScratchName = this\.project\?\.name \|\| ''/)
})

test('问题 12：有项目时右栏「AI 助手 | 依据」tab 条常驻，没打开可解析文档时「依据」禁用而不是消失', () => {
  assert.match(page, /<view v-if="rightDockTabs\.length" class="right-dock-tabs">/)
  assert.match(page, /v-for="p in rightDockTabs"/)
  assert.match(page, /:class="\{ active: rightPaneKey === p\.key, 'is-disabled': p\.disabled, 'is-movable': !p\.disabled \}"/)
  assert.match(page, /@tap="!p\.disabled && switchRightPane\(p\.key\)"/)
  const body = methodBody(page, '    rightDockTabs() {')
  assert.match(body, /resolveDocks\(this\.panelDockOverrides, this\.allDockPanels\)/, 'tab 条要按全部面板排，不跟着「依据」可不可用增减')
  assert.match(body, /disabled: !available\.has\(p\.key\)/)
  // dockPanels 仍只含此刻可用的面板（左栏 / 菜单 / 拖放都按它判定，行为不变）
  assert.match(methodBody(page, '    dockPanels() {'), /this\.allDockPanels\.filter\(p => available\.has\(p\.key\)\)/)
})
