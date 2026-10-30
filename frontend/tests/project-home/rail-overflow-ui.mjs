// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual rail template + styles, synthetic project/plugins; no backend or user profile.
// Run: node tests/project-home/rail-overflow-ui.mjs
// RAIL_BASELINE=1 renders HEAD to verify that the original overflow fails this test.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { compile } from '@vue/compiler-dom'
import * as sass from 'sass'
import puppeteer from 'puppeteer-core'
import { ICONS } from '../../src/config/icons.js'

const require = createRequire(import.meta.url)
const read = name => process.env.RAIL_BASELINE === '1'
  ? execFileSync('git', ['show', `HEAD:frontend/src/pages/project-overview/${name}`], { encoding: 'utf8' })
  : fs.readFileSync(new URL(`../../src/pages/project-overview/${name}`, import.meta.url), 'utf8')
const source = read('project-overview.vue')
const start = source.indexOf('<view class="left-rail">')
assert.ok(start > 0)
const template = source.slice(start, source.indexOf('<!-- File Picker Dialog', start))
  .replace(/@tap/g, '@click')
const render = compile(template, { mode: 'function', isCustomElement: () => true }).code
const css = sass.compileString(read('project-overview.scss'), { logger: sass.Logger.silent }).css
const appStyles = fs.readFileSync(new URL('../../src/App.vue', import.meta.url), 'utf8')
const hairlineCss = appStyles.slice(appStyles.indexOf('/* ---- 悬浮细滑轨'), appStyles.indexOf('/* mac：三颗交通灯'))
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setRequestInterception(true)
  page.on('request', request => request.abort())
  await page.setContent(`<style>${hairlineCss}\n${css}
    :root {--awd-bg:#f1efe6;--awd-surface:#fffdf9;--awd-surface-2:#e4efeb;--awd-text:#262923;--awd-text-2:#63685f;--awd-border:#d9d8cc;--awd-border-strong:#c3bca9;--awd-accent:#2e6056;--awd-accent-text:#2e6056;--awd-accent-soft:#e4efeb}
    body{margin:0;font:14px system-ui}view,text,scroll-view{display:block}#app{height:100vh;display:flex;flex-direction:column}.test-header{height:48px;flex-shrink:0}.test-status{height:26px;flex-shrink:0}
  </style><div id="app"></div>`)
  await page.addScriptTag({ path: require.resolve('vue/dist/vue.global.prod.js') })
  await page.addScriptTag({ content: `
    const rail = {render:(()=>{${render}})(), data:()=>({
      LEFT_SIDEBAR_PLUGINS: Array.from({length:30},(_,i)=>({key:'tool-'+i,label:'工具 '+i,svgPaths:[{d:'M4 4h16v16H4z'}]})),
      leftPaneKey:'tool-0',sidebarCollapsed:false,stagingPinned:false,isClientView:false,draggingRailKey:null,isExplorerPane:false,
      hasNamedProject:true,projectMembers:[{id:1,displayName:'测试成员'}],groupedMembers:[{label:'项目成员',list:[{id:1,displayName:'测试成员'}]}],
      GLYPHS:${JSON.stringify(ICONS)}, VERSION_PLUGIN:{label:'版本控制',svgPaths:[{d:'M4 4h16v16H4z'}]}, versionEntry:{badge:'',title:'版本控制'},
      railScheduleCount:0,pluginUpdateState:{count:0},ddClientUnread:0,ddLawyerNotifications:[],showInviteModal:false
    }), methods:{ $t:k=>k,isMovablePanel:()=>false,getInitial:n=>n[0],onRailBtnTap(k){this.leftPaneKey=k},toggleLeftPane(k){this.leftPaneKey=k},onRailDragStart(){},onRailDragOver(){},onRailDragEnd(){},openDockMenu(){},openFeedback(){},openProjectVersionPanel(){this.leftPaneKey="version"} }};
    const app=Vue.createApp({template:'<div class="test-header">合成侧栏验收</div><div class="main-layout"><Rail ref="rail"/><div>工具区域</div></div><div class="test-status">状态栏</div>',components:{Rail:rail}});
    app.config.errorHandler=e=>console.error(String(e.stack));
    window.railTest=app.mount('#app').$refs.rail;
  ` })
  for (const height of [480, 640, 900]) {
    await page.setViewport({ width: 1100, height })
    const before = await page.evaluate(() => {
      const rail = document.querySelector('.left-rail')
      return [...rail.querySelectorAll('.rail-btn:not([draggable]),.rail-members-container')].map(el => {
        const r=el.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height}
      })
    })
    assert.equal(before.length, 4)
    for (const rect of before) {
      assert.ok(rect.top >= 48 && rect.bottom <= height - 26, `fixed action outside viewport at ${height}px: ${JSON.stringify(rect)}`)
      assert.equal(rect.height, 40, 'buttons must not shrink')
    }
    await page.mouse.move(900, 20)
    const scrollbar = await page.$eval('.rail-tools', el => ({
      width: getComputedStyle(el, '::-webkit-scrollbar').width,
      color: getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor,
    }))
    assert.equal(scrollbar.width, '4px')
    assert.equal(scrollbar.color, 'rgba(0, 0, 0, 0)', 'idle rail scrollbar is transparent')
    await page.mouse.move(25, 130)
    await page.mouse.wheel({ deltaY: 2000 })
    await page.waitForFunction(() => {
      const last=document.querySelector('[title="工具 29"]'); const r=last.getBoundingClientRect()
      const area=last.parentElement.getBoundingClientRect(); return r.top>=area.top && r.bottom<=area.bottom
    }, { timeout: 3000 })
    await page.click('[title="工具 29"]')
    assert.ok(await page.$('[title="工具 29"].active'), 'last tool remains clickable')
    const after=await page.evaluate(() => [...document.querySelectorAll('.left-rail .rail-btn:not([draggable]),.rail-members-container')].map(el=>el.getBoundingClientRect().top))
    assert.deepEqual(after,before.map(r=>r.top),'scrolling must not move fixed actions')
    await page.hover('.rail-members-container')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.members-expand-panel-left')).opacity === '1')
    const exposed=await page.evaluate(() => {
      const panel=document.querySelector('.members-expand-panel-left'),r=panel.getBoundingClientRect()
      return panel.contains(document.elementFromPoint(r.left+20,r.top+20))
    })
    assert.ok(exposed,'member popover must escape rail clipping')
  }
  await page.evaluate(() => { window.railTest.hasNamedProject=false; window.railTest.LEFT_SIDEBAR_PLUGINS=window.railTest.LEFT_SIDEBAR_PLUGINS.slice(0,3) })
  await page.waitForFunction(() => document.querySelectorAll('.rail-footer .rail-btn').length === 1)
  assert.equal(await page.$('.rail-members-container'), null, 'no project means no project members')
  assert.ok(await page.evaluate(() => { const area=document.querySelector('.rail-tools'); return area.scrollHeight===area.clientHeight }), 'short lists do not need scrolling')
  if (process.env.RAIL_SCREENSHOT) await page.screenshot({path:process.env.RAIL_SCREENSHOT})
  assert.deepEqual(errors, [], 'rail must render without script errors')
  console.log('PASS: 30 tools, 480/640/900px windows, wheel + last tool click, fixed actions, unclipped member popover')
} finally { await browser.close() }
