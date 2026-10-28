// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real ChatInterface and RootBubble, synthetic history, classic-width scrollbars.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'
const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = fileURLToPath(new URL('./', import.meta.url))
const appSource = readFileSync(`${root}src/App.vue`, 'utf8')
const tokens = appSource.slice(appSource.indexOf("html,\nhtml[data-theme='light']"), appSource.indexOf('</style>', appSource.indexOf("html,\nhtml[data-theme='light']")))
const shellSource = readFileSync(`${root}src/pages/project-overview/project-overview.scss`, 'utf8')
const centeredRule = shellSource.match(/\.page-project-overview\.chat-mode:not\(\.chat-canvas-open\) \.side-panel-ai :deep\(\.message-list-content\),[\s\S]*?\n\}/)?.[0].replace(/:deep\(([^)]+)\)/g, '$1')
assert.ok(centeredRule, 'use the actual dialog-mode centering rule')
const server = await createServer({ configFile: false, root: fixture, plugins: [vue()], resolve: { alias: { '@': `${root}src` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } })
await server.listen()
let browser
const out = process.env.AWD_SHOTS || '/tmp/chat-scrollbar-stability'
mkdirSync(out, { recursive: true })
const failures = [], observations = []
const check = (condition, message) => { if (!condition) failures.push(message) }
try {
  for (const classic of [true, false]) {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, ignoreDefaultArgs: classic ? ['--hide-scrollbars'] : [] })
  const page = await browser.newPage()
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))))
  const measure = () => page.evaluate(() => {
    const list = document.querySelector('.message-list'), content = document.querySelector('.message-list-content'), composer = document.querySelector('.input-area-wrapper'), summary = document.querySelector('.activity-summary')
    const l = list.getBoundingClientRect(), c = content.getBoundingClientRect(), p = composer.getBoundingClientRect(), s = summary.getBoundingClientRect()
    return { left: c.left, width: c.width, center: (c.left + c.right) / 2, composerCenter: (p.left + p.right) / 2,
      scrollTop: list.scrollTop, overflow: list.scrollHeight > list.clientHeight, gutter: list.offsetWidth - list.clientWidth,
      summaryTop: s.top, listTop: l.top, horizontalOverflow: content.scrollWidth > content.clientWidth }
  })
  for (const [width, direction, dialog] of [[1280,'ltr',true], [980,'rtl',true], [350,'ltr',false], [280,'rtl',false]]) {
    const label = `${classic ? 'classic' : 'headless-default'}/${width}/${direction}/${dialog ? 'dialog' : 'sidebar'}`
    await page.setViewport({ width, height: 960 })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
    await page.waitForFunction(() => window.ready)
    await page.addStyleTag({ content: `${tokens}\nhtml,body,#app {margin:0;height:100%;font-family:system-ui;} *{box-sizing:border-box;} view,scroll-view{display:block;} text{display:inline;} #app{height:100dvh;} ${centeredRule}\n${classic ? '.message-list::-webkit-scrollbar{width:14px;}' : ''}` })
    await page.evaluate(async ({ direction, dialog }) => {
      document.documentElement.dir = direction
      document.body.className = `page-project-overview ${dialog ? 'chat-mode' : ''}`
      document.querySelector('#app').className = 'side-panel-ai'
      const process = Array.from({length:16}, (_,i)=>`<process name="步骤${i}"><tool_code>read_document({"fileId":${i+1}})</tool_code><tool_output status="SUCCESS">合成结果${i}</tool_output></process>`).join('')
      window.chat.loadMessages('gutter-fixture', [{id:'u',role:'USER',content:'核对合成材料'}, {id:'a',role:'ASSISTANT',content:process+'<final>合成结果：已完成核对。</final>'}])
    }, { direction, dialog })
    await settle()
    const initial = await measure()
    if (classic) check(initial.gutter === 28, `${label}: symmetrical classic native gutter`)
    check(!initial.overflow, `${label}: collapsed fixture must fit`)
    for (let cycle=0; cycle<3; cycle++) {
      await page.click('.activity-summary'); await settle()
      const expanded = await measure()
      check(expanded.overflow, `${label}/${cycle}: expanded fixture must overflow`)
      check(Math.abs(expanded.left-initial.left)<0.5 && Math.abs(expanded.width-initial.width)<0.5, `${label}/${cycle}: body horizontal geometry must stay stable: ${JSON.stringify({initial,expanded})}`)
      check(Math.abs(expanded.composerCenter-initial.composerCenter)<0.5, `${label}/${cycle}: composer center stays stable`)
      check(Math.abs(expanded.scrollTop-initial.scrollTop)<0.5, `${label}/${cycle}: manual expansion must not jump to bottom (${initial.scrollTop} -> ${expanded.scrollTop})`)
      if (dialog) check(Math.abs(expanded.center-expanded.composerCenter)<0.5, `${label}/${cycle}: body and composer share center`)
      check(expanded.summaryTop >= expanded.listTop, `${label}/${cycle}: expanded summary stays visible before any second click`)
      check(!expanded.horizontalOverflow, `${label}/${cycle}: no horizontal clipping`)
      await page.click('.activity-summary'); await settle()
      const collapsed = await measure()
      check(!collapsed.overflow, `${label}/${cycle}: collapsing removes overflow`)
      check(Math.abs(collapsed.left-initial.left)<0.5, `${label}/${cycle}: collapse restores unchanged x`)
      observations.push({label,cycle,initial,expanded,collapsed})
    }
    await page.screenshot({path:`${out}/${classic ? 'classic' : 'headless-default'}-${width}-${direction}.png`})
  }
  // Each manual disclosure must pause following before ResizeObserver handles its height.
  await page.setViewport({ width: 1280, height: 700 })
  for (const kind of ['root-thinking', 'inline-thinking', 'tool-output', 'process-header']) {
    console.log('Disclosure:', classic, kind)
    await page.evaluate(kind => {
      document.documentElement.dir = 'ltr'
      document.body.className = 'page-project-overview chat-mode'
      const long = Array.from({length:40},(_,i)=>`合成内容 ${i}。`).join('\n\n')
      let body = kind === 'root-thinking' ? `<thinking>${long}</thinking>`
        : `<process name="合成读取"><tool_code>read_document({"fileId":1})</tool_code><tool_output status="SUCCESS">${kind === 'tool-output' ? long : '合成结果'}</tool_output></process>`
      window.chat.loadMessages('reading-'+kind, [{id:'u-'+kind,role:'USER',content:'核对合成材料'}, {id:'a-'+kind,role:'ASSISTANT',content:body+'<final>核对完成。</final>'}])
      if (kind === 'inline-thinking') {
        // Legacy in-memory bubbles have no timeline; the current parser lifts thinking to root entries.
        const bubble = window.chatState.bubbles.find(b => b.role === 'ASSISTANT')
        bubble.processes[0].items.unshift({type:'thinking',status:'done',content:long})
        bubble.timeline = []
      }
    }, kind)
    await settle()
    if (kind !== 'root-thinking') {
      await page.click('.activity-summary'); await settle()
      if (kind === 'process-header') { await page.click('.process-header'); await settle() }
      if (await page.$('.back-to-latest')) { await page.click('.back-to-latest'); await settle() }
    }
    const before = await page.$eval('.message-list', el => el.scrollTop)
    check(await page.evaluate(() => window.chatState.followLatest), `${kind}: start in follow mode`)
    const selector = {'root-thinking':'.thinking-card .header', 'inline-thinking':'.thinking-inline .h-wrap', 'tool-output':'.tool-row', 'process-header':'.process-header'}[kind]
    await page.click(selector); await settle()
    check(!(await page.evaluate(() => window.chatState.followLatest)), `${kind}: actual disclosure pauses following`)
    check(await page.$eval('.message-list', el => el.scrollTop) === before, `${kind}: actual disclosure preserves scrollTop`)
    if (await page.$('.back-to-latest')) { await page.click('.back-to-latest'); await settle() }
    check(await page.evaluate(() => window.chatState.followLatest), `${kind}: back-to-latest resumes following`)
  }
  await page.evaluate(async () => { await window.loadRunningFixture(); window.chat.scrollToBottom?.() })
  // Real back-to-latest action is available after an explicit move upwards.
  await page.evaluate(() => { const list=document.querySelector('.message-list'); list.scrollTop=0; list.dispatchEvent(new Event('scroll')) })
  await settle()
  await page.click('.back-to-latest'); await settle()
  check(await page.evaluate(() => window.chatState.followLatest), 'streaming resumes following')
  await page.evaluate(() => { window.chatState.bubbles.at(-1).content += '\n\n'+ '合成流式增量。\n\n'.repeat(60) })
  await settle()
  check(await page.$eval('.message-list', el => el.scrollHeight-el.clientHeight-el.scrollTop < 2), 'streaming height growth still follows latest')
  await browser.close(); browser = null
  }
  writeFileSync(`${out}/metrics.json`, JSON.stringify(observations, null, 2))

  assert.deepEqual(failures, [])
  console.log('PASS: 24 overflow cycles; dialog/sidebar LTR/RTL geometry; four disclosure paths; back-to-latest and streaming follow')
} finally { await browser?.close(); await server.close() }
