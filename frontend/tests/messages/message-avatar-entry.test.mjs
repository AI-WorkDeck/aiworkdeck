// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real AccountEntry and tab methods with synthetic account state; no live account or backend.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isPaneAllowedWithoutProject, NO_PROJECT_DEFAULT_PANE } from '../../src/pages/project-overview/noProjectShell.js'
import { ICONS } from '../../src/config/icons.js'
import zh from '../../src/locales/zh-CN/messageCenter.js'
import workbench from '../../src/locales/zh-CN/workbench.js'
import account from '../../src/locales/zh-CN/account.js'
import calendar from '../../src/locales/zh-CN/calendar.js'
import welcome from '../../src/locales/zh-CN/welcome.js'

const require = createRequire(import.meta.url)
const { parse, compileStyle } = require('@vue/compiler-sfc')
const puppeteer = require('puppeteer-core')
const sass = require('sass')
const read = rel => readFileSync(new URL('../../src/' + rel, import.meta.url), 'utf8')
const descriptor = parse(read('components/account/AccountEntry.vue')).descriptor
const script = descriptor.script.content.replace(/^import .*$/gm, '').replace('export default', 'return')
const sidebar = read('config/leftSidebarPlugins.js').replace(/^import .*$/gm, '').replace(/export /g, '')
const { LEFT_SIDEBAR_PLUGINS, migrateLeftPaneKey } = new Function('t', sidebar + '\nreturn { LEFT_SIDEBAR_PLUGINS, migrateLeftPaneKey }')(key => key)
const tabs = read('pages/project-overview/messageCenterTab.js').replace(/^import .*$/gm, '').replace('export const messageCenterTabMethods =', 'const messageCenterTabMethods =')

function entry(props = {}) {
  const component = new Function('ICONS', 'ACCOUNT_CHANGED_EVENT', 'setGlobalOverlay', 'isAccountSessionExpired', script)(ICONS, 'account-changed', () => {}, () => false)
  const emitted = [], vm = { ...component.data(), clientView: false, messageUnread: null, messagePartial: false, ...props, $t: (key, args) => (zh[key.split('.').at(-1)] || key).replace('{count}', args?.count), $emit: event => emitted.push(event) }
  for (const [name, compute] of Object.entries(component.computed)) Object.defineProperty(vm, name, { get: () => compute.call(vm) })
  for (const [name, method] of Object.entries(component.methods)) vm[name] = method.bind(vm)
  return { vm, emitted }
}

test('avatar unread and unavailable-source states stay distinct and retain the account warning', () => {
  const { vm, emitted } = entry({ loggedIn: true, messageUnread: 104, walletLow: true })
  assert.equal(vm.messageBadgeText, '99+')
  assert.equal(vm.attention, true)
  assert.match(vm.messageHint, /104/)
  vm.messagePartial = true
  assert.match(vm.messageHint, /104/)
  assert.match(vm.messageHint, /部分来源/)
  vm.messageUnread = 0
  assert.equal(vm.showMessageBadge, true)
  assert.equal(vm.messageBadgeText, '·')
  vm.messagePartial = false
  assert.equal(vm.showMessageBadge, false)
  vm.menuOpen = true
  vm.emitAndClose('messages')
  assert.deepEqual(emitted, ['messages'])
  assert.equal(vm.menuOpen, false)
  vm.clientView = true; vm.messageUnread = 9
  assert.equal(vm.showMessageBadge, false)
})

test('message center leaves the rail and stale preferences leave no empty panel without a project', () => {
  assert.equal(LEFT_SIDEBAR_PLUGINS.some(plugin => plugin.key === 'messages'), false)
  assert.equal(migrateLeftPaneKey('messages'), 'files')
  assert.equal(isPaneAllowedWithoutProject('messages') ? 'messages' : NO_PROJECT_DEFAULT_PANE, null)
  const host = read('pages/project-overview/project-overview.vue')
  const start = host.indexOf('<AccountEntry'), tag = host.slice(start, host.indexOf('/>', start))
  assert.match(tag, /:message-unread="messageCenterUnread"/)
  assert.match(tag, /:message-partial="messageCenterBadgePartial"/)
  assert.match(tag, /@messages="openMessageCenterTab"/)
  assert.doesNotMatch(read('pages/project-overview/panelSwitching.js'), /key === 'messages'/)
})

const executablePath = process.env.MESSAGE_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
test('Chrome avatar and signed-out entries open the singleton with mouse and keyboard without moving the sidebar', { skip: !existsSync(executablePath), timeout: 30000 }, async t => {
  const css = compileStyle({ source: sass.compileString(descriptor.styles[0].content).css, filename: 'AccountEntry.vue', id: 'data-v-account', scoped: true }).code
  const appSource = read('App.vue')
  const theme = ['light', 'dark'].map(mode => `html${mode === 'dark' ? '[data-theme="dark"]' : ''}{${appSource.match(new RegExp(`/\\* AWD-TOKENS:BEGIN app-${mode} \\*/([\\s\\S]*?)/\\* AWD-TOKENS:END app-${mode} \\*/`))[1]}}`).join('\n')
  // The isolated harness maps uni's tap event to the browser click event used by H5.
  const template = descriptor.template.content.replace(/@tap/g, '@click')
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${theme}${css}body{margin:0;font:13px sans-serif;background:var(--awd-bg);color:var(--awd-text)}#app{padding:18px;display:flex;justify-content:flex-end}view{display:block}#workspace{margin-top:50px;position:absolute;left:24px}button{color:inherit}</style><div id="app"></div><script src="/vue.js"></script><script>
  const ICONS=${JSON.stringify(ICONS)},ACCOUNT_CHANGED_EVENT='account-changed',setGlobalOverlay=()=>{},isAccountSessionExpired=()=>false,uni={$on(){},$off(){}};
  const AccountEntry={...(()=>{${script}})(),template:${JSON.stringify(template)},__scopeId:'data-v-account'};
  ${tabs}
  const state=Vue.reactive({loggedIn:true,clientView:false,messageUnread:7,messagePartial:false,walletLow:true,leftFiles:[],rightFiles:[],focusedPane:'left',splitMode:false,leftPaneKey:'files',sidebarCollapsed:true});window.state=state;
  const translate=(key,args)=>{const [namespace,name]=key.split('.');let value=(${JSON.stringify({messageCenter:zh,workbench,account,calendar,welcome})})[namespace]?.[name]||key;return value.replace('{count}',args?.count)};
  const host={...state,$t:translate,$nextTick:fn=>fn(),triggerWorkbenchResize(){}};Object.keys(state).forEach(key=>Object.defineProperty(host,key,{get:()=>state[key],set:value=>state[key]=value}));
  const open=()=>messageCenterTabMethods.openMessageCenterTab.call(host);
  const app=Vue.createApp({render:()=>Vue.h('div',[Vue.h(AccountEntry,{loggedIn:state.loggedIn,clientView:state.clientView,messageUnread:state.messageUnread,messagePartial:state.messagePartial,walletLow:state.walletLow,onMessages:open,onLogin:()=>window.loginRequested=true}),Vue.h('div',{id:'workspace'},state.leftFiles.map(tab=>Vue.h('button',{class:'message-tab'},tab.name)))])});app.config.globalProperties.$t=translate;app.mount('#app');</script></html>`
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/vue.js' ? 'text/javascript' : 'text/html; charset=utf-8')
    res.end(req.url === '/vue.js' ? readFileSync(require.resolve('vue/dist/vue.global.js')) : html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 900, height: 560 } })
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)) })
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForSelector('.account-message-badge')
  assert.equal(await page.$eval('.account-message-badge', element => element.textContent), '7')
  assert.ok(await page.$('.account-attention-dot.with-message-badge'))
  await page.click('.avatar-btn')
  assert.equal(await page.$eval('.avatar-menu-item', element => element.classList.contains('avatar-menu-messages')), true)
  const output=process.env.MESSAGE_SCREENSHOT_DIR || '/tmp/message-center-review'; mkdirSync(output,{recursive:true})
  await page.screenshot({ path:output+'/avatar-menu.png' })
  await page.click('.avatar-menu-messages')
  await page.waitForSelector('.message-tab')
  assert.equal(await page.$('.avatar-menu'), null)
  await page.focus('.avatar-btn'); await page.keyboard.press('Enter')
  await page.focus('.avatar-menu-messages'); await page.keyboard.press('Space')
  assert.deepEqual(await page.evaluate(() => ({ count:state.leftFiles.length, pane:state.leftPaneKey, collapsed:state.sidebarCollapsed, split:state.splitMode })), { count:1,pane:'files',collapsed:true,split:false })
  await page.evaluate(() => { state.messagePartial=true; state.messageUnread=0 })
  await page.waitForFunction(() => document.querySelector('.account-message-badge').textContent === '·')
  await page.click('.avatar-btn'); await page.screenshot({ path:output+'/avatar-menu-partial.png' })
  await page.keyboard.press('Escape'); assert.equal(await page.$('.avatar-menu'),null)
  await page.evaluate(() => { state.loggedIn=false; state.walletLow=false; state.messageUnread=2 })
  await page.waitForSelector('.signed-out-messages')
  await page.click('.signed-out-messages')
  assert.equal(await page.evaluate(() => state.leftFiles.length),1)
  assert.equal(await page.evaluate(() => !!window.loginRequested),false)
  await page.evaluate(() => { state.clientView=true })
  await page.waitForFunction(() => !document.querySelector('.signed-out-messages'))
  await page.evaluate(() => { state.loggedIn=true })
  await page.waitForSelector('.avatar-btn'); await page.click('.avatar-btn')
  assert.equal(await page.$('.avatar-menu-messages'),null)
  assert.equal(await page.$('.account-message-badge'),null)
  assert.deepEqual(errors,[])
})
