// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real uni workbench, isolated browser storage and synthetic API only. Run against dev:h5.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const base = process.env.FOLDER_ENTRY_UI_BASE || 'http://127.0.0.1:5379'
const out = process.env.FOLDER_ENTRY_UI_OUT || '/tmp/awd-folder-entry-ui'
fs.mkdirSync(out, { recursive: true })
const project = { id: 42, name: '侧栏合成测试项目', userId: 7, projectType: 'BLANK', localRoot: '/synthetic/sidebar' }
const plugins = Array.from({ length: 24 }, (_, i) => ({ id: `synthetic-plugin-${i}`, name: `合同审查与文书整理插件 ${i + 1}`, description: '用于验证窄侧栏中文名称、描述与操作按钮的布局', version: '1.0.0', enabled: true }))
const skills = Array.from({ length: 24 }, (_, i) => ({ id: `synthetic-skill-${i}`, name: `法律资料整理技能 ${i + 1}`, description: '合成数据：整理资料和核对文书', version: '1.0.0', category: 'contract', priceCents: 0, downloads: 12 }))
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
const apiRequests = []
const checks = []
const screenshots = []
page.on('pageerror', error => errors.push(error.message))
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => {
  window.checkbaDesktop = {fs:{showOpenDialog:async()=>({canceled:true,filePaths:[]})}};
  if (location.protocol !== 'about:' && !sessionStorage.getItem('welcome-sidebar-seeded')) {
    localStorage.clear()
    localStorage.setItem('awd_app_language', 'zh-CN')
    localStorage.setItem('awd_theme', 'light')
    sessionStorage.setItem('welcome-sidebar-seeded', '1')
  }
})
await page.setRequestInterception(true)
page.on('request', async request => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) {
    // Only this test's frontend server may receive requests. No real local backend or external service.
    if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return request.abort()
    return request.continue()
  }
  apiRequests.push(url.pathname)
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }
  if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
  let body = []
  if (url.pathname === '/api/projects/42') body = project
  else if (url.pathname === '/api/projects/my') body = Array.from({length:40}, (_,i)=>({...project,id:42+i,name:'Synthetic project '+(42+i)}))
  else if (url.pathname === '/api/auth/me') body = { id: 7, username: 'synthetic' }
  else if (url.pathname === '/api/plugins/list') body = plugins
  else if (url.pathname === '/api/skills/list') body = []
  else if (url.pathname === '/api/skills/market/list') body = { skills, accountConnected: false }
  else if (url.pathname === '/api/plugins/market/list') body = { plugins: [], accountConnected: false }
  else if (url.pathname === '/api/plugins/bundled') body = { plugins: [] }
  else if (url.pathname.includes('/license/status')) body = { mode: 'none', accountConnected: false }
  else if (url.pathname === '/api/account/status') body = { connected: false }
  else if (url.pathname.includes('/version/status')) body = { enabled: false }
  else if (url.pathname.includes('/profile') || url.pathname.includes('/admin/config')) body = {}
  else if (url.pathname.includes('/telemetry/settings')) body = { enabled: false }
  return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
})


try {
 const result=[]
 await page.goto(base+'/#/pages/project-overview/project-overview?id=42&pane=projects',{waitUntil:'networkidle0'})
 await page.waitForSelector('.folder-catalog',{visible:true})
 assert.equal(await page.$('.project-list-pane'),null)
 assert.ok(await page.$('[data-action="open-folder"]'))
 assert.ok(await page.$('.account-catalog'))
 assert.equal(await page.$$eval('.folder-row',els=>els.length),40)
 await page.type('.folder-search input','81')
 await page.waitForFunction(()=>document.querySelectorAll('.folder-row').length===1)
 await page.click('.project-switcher')
 await page.waitForSelector('.switcher-list',{visible:true})
 assert.equal(await page.$$eval('.switcher-list .switcher-item',els=>els.length),40)
 await page.type('.switcher-search input','81')
 await page.waitForFunction(()=>document.querySelectorAll('.switcher-list .switcher-item').length===1)
 await page.screenshot({path:out+'/named.png'})
 result.push('Named folder: legacy link opens welcome catalog; full 40-item search works in both entries')
 await page.goto('about:blank')
 await page.goto(base+'/#/pages/project-overview/project-overview',{waitUntil:'networkidle0'})
 await page.waitForSelector('.project-switcher',{visible:true})
 const collapsed=await page.$eval('.sidebar-left',el=>el.getBoundingClientRect().width)
 assert.ok(collapsed<80,'no project must not show empty sidebar: '+collapsed)
 await page.click('.project-switcher')
 await page.waitForSelector('.switcher-list',{visible:true})
 assert.equal(await page.$$eval('.switcher-list .switcher-item',els=>els.length),40)
 await page.click('.switcher-all')
 await page.waitForSelector('.folder-catalog',{visible:true})
 await page.screenshot({path:out+'/empty.png'})
 result.push('No project: collapsed sidebar; top switcher and welcome full catalog reachable')
 assert.ok(!apiRequests.some(url=>/projects\/(null|undefined)\//.test(url)))
 assert.deepEqual(errors,[])
 fs.writeFileSync(out+'/result.json',JSON.stringify({result,errors},null,2))
 console.log(result)
} finally { await browser.close() }
