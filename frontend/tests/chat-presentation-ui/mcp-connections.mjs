// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real chat, marketplace and settings components with synthetic MCP HTTP responses.
import assert from 'node:assert/strict'
import { advancedMcpCases } from './mcp-advanced-cases.mjs'
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = '/tmp/awd-mcp-ui-1598'; mkdirSync(output, { recursive: true })
const source = readFileSync(`${root}src/App.vue`, 'utf8')
const tokens = source.slice(source.indexOf("html,\nhtml[data-theme='light']"), source.indexOf('</style>', source.indexOf("html,\nhtml[data-theme='light']")))
const server = await createServer({ configFile: false, cacheDir: output + '/vite-cache', root: fileURLToPath(new URL('./', import.meta.url)), plugins: [vue()], resolve: { alias: { '@': `${root}src` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 5243, strictPort: true, fs: { allow: [root] } } })
await server.listen()
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage(), errors = [], blocked = [], logs = [], consoleReads = []
page.on('console', message => {
  logs.push(message.text())
  consoleReads.push(Promise.all(message.args().map(arg => arg.jsonValue().catch(() => undefined))).then(values => logs.push(JSON.stringify(values))))
})
page.on('pageerror', error => errors.push(error.message))
await page.setRequestInterception(true)
page.on('request', request => {
  if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5243/')) { blocked.push(request.url()); request.abort() }
  else request.continue()
})
const clickText = async (selector, text) => page.evaluate(({ selector, text }) => {
  const el = [...document.querySelectorAll(selector)].find(el => el.textContent.trim() === text)
  if (!el) throw new Error('Missing button: ' + text)
  el.click()
}, { selector, text })
try {
  await page.setViewport({ width: 1100, height: 1000 })
  await page.goto('http://127.0.0.1:5243/')
  await page.waitForFunction(() => window.ready)
  await page.addStyleTag({ content: `${tokens}\nhtml,body{margin:0;font-family:system-ui;background:var(--awd-bg)}*{box-sizing:border-box}view,scroll-view{display:block}#app{height:500px}#market-test{height:650px;width:320px}#admin-test{height:850px}` })
  await page.evaluate(async root => {
    const original = uni.request
    window.mcpCalls = []; window.mcpFail = false
    const row = { id: 'qichacha', presetId: 'qichacha', name: '企查查', url: 'https://example.invalid/mcp', enabled: false, configured: false, tested: false, source: 'official', revision: 0, tools: [] }
    window.mcpRow = row
    uni.showModal = options => { window.lastConfirm = options.content; options.success({ confirm: true }) }
    uni.navigateTo = options => { window.lastNavigation = options.url }
    uni.request = options => {
      if (options.url.includes('/api/mcp/connections')) {
        window.mcpCalls.push({ method: options.method || 'GET', url: options.url, data: options.data, scope: options.header?.['X-MCP-Scope'] })
        const scopeToken = 'scope:' + window.fixtureStorage.checkba_user.id
        if (options.method && options.method !== 'GET' && options.header?.['X-MCP-Scope'] !== scopeToken) return options.success({ statusCode: 200, data: { code: 1, message: 'Scope changed' } })
        if (window.delayMcpSave && options.method === 'PUT') {
          window.pendingMcpSave = () => {
            window.delayedScopeRejected = options.header?.['X-MCP-Scope'] !== 'scope:' + window.fixtureStorage.checkba_user.id
            options.success({ statusCode: 200, data: { code: 1, message: 'Scope changed' } })
          }
          return {}
        }
        const ok = data => options.success({ statusCode: 200, data: { code: 0, ...data } })
        if (options.url.endsWith('/test')) {
          if (window.mcpFail) return options.success({ statusCode: 200, data: { code: 1, message: 'Synthetic connection failure' } })
          row.tested = true; row.tools = [{ name: 'company_lookup', description: 'Synthetic company search' }]
        } else if (options.url.endsWith('/enable')) { row.enabled = options.data.enabled; row.source = row.enabled ? 'custom' : 'official' }
        else if (options.method === 'POST' && options.url.endsWith('/connections')) { row.id = 'custom-1'; row.presetId = null; row.name = options.data.name; row.url = options.data.url; row.configured = !!options.data.token; row.revision = 1; row.tested = false; row.source = 'disabled' }
        else if (options.method === 'PUT') { row.configured = !!options.data.token || row.configured; row.revision++; row.tested = false; row.name = options.data.name }
        else if (options.method === 'DELETE') { row.configured = false; row.revision = 0; row.enabled = false; row.source = 'official'; row.deleted = true }
        return ok({ scopeToken, connections: row.deleted ? [] : [{ ...row }], presets: [{ id: 'qichacha', supportsOfficial: true, documentationUrl: 'https://example.invalid/docs' }], connection: { ...row } })
      }
      if (options.url.includes('/api/skills/list')) return options.success({ statusCode: 200, data: [
        { id: 'text-to-speech', name: '语音合成', enabled: true },
        { id: 'tencent-meeting', name: '腾讯会议', enabled: true },
        { id: 'meeting-workflow', sourcePluginId: 'tencent-meeting', name: '会议工作方法', enabled: true },
        { id: 'research', name: '研究方法', enabled: true },
      ] })
      return original(options)
    }
    const vueUrl = performance.getEntriesByType('resource').find(entry => /\/vue\.js\?/.test(entry.name)).name
    const { createApp, h } = await import(vueUrl)
    const { i18n } = await import('/@fs/' + root + 'src/i18n/index.js')
    window.fixtureI18n = i18n
    const { default: Market } = await import('/@fs/' + root + 'src/components/MarketSidebarPanel.vue')
    const element = document.createElement('div'); element.id = 'market-test'; document.body.append(element)
    const app = createApp({ render: () => h(Market) }); app.use(i18n)
    app.provide('openSettingsTab', async options => {
      window.openedSettings = options
      if (window.settingsApp) window.settingsApp.unmount()
      let el = document.getElementById('admin-test')
      if (!el) { el = document.createElement('div'); el.id = 'admin-test'; document.body.append(el) }
      const { default: Admin } = await import('/@fs/' + root + 'src/components/admin/AdminPane.vue')
      window.settingsApp = createApp({ render: () => h(Admin, { embedded: true, initialNav: options.nav }) })
      window.settingsApp.use(i18n); window.settingsApp.mount(el)
    }); app.mount(element)
  }, root)
  await page.evaluate(() => window.chatState.toggleSkillDropdown())
  await page.waitForFunction(() => document.querySelector('.skill-dropdown')?.textContent.includes('会议工作方法'))
  const skills = await page.$eval('.skill-dropdown', el => el.textContent)
  assert.ok(!skills.includes('语音合成')); assert.ok(!skills.includes('腾讯会议纪要')); assert.ok(skills.includes('来自插件'))
  assert.ok(skills.includes('MCP 连接'))
  assert.equal(await page.$$eval('#market-test .msb-tabs', rows => rows.every(el => el.children.length === 3)), true)
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('#market-test .msb-tabs .msb-tab')) el.dispatchEvent(new CustomEvent('tap', { bubbles: true }))
  })
  await page.waitForFunction(() => [...document.querySelectorAll('#market-test .msb-row')].some(el => el.textContent.includes('企查查')))
  await page.evaluate(() => [...document.querySelectorAll('#market-test .msb-row')].find(el => el.textContent.includes('企查查')).dispatchEvent(new CustomEvent('tap', { bubbles: true })))
  await page.waitForSelector('#admin-test .mcp-card')
  assert.equal(await page.evaluate(() => window.openedSettings.nav), 'mcp')
  await clickText('#admin-test button', '配置')
  await page.select('#admin-test select[name=mcp-auth]', 'bearer')
  await page.waitForSelector('#admin-test input[type=password]')
  await page.type('#admin-test input[type=password]', 'synthetic-token')
  await clickText('#admin-test button', '保存')
  await page.waitForFunction(() => window.mcpRow.revision === 1 && !document.querySelector('.mcp-editor'))
  await clickText('#admin-test button', '测试连接')
  await page.waitForFunction(() => window.mcpRow.tested)
  await clickText('#admin-test button', '启用 AI 调用')
  await page.waitForFunction(() => window.mcpRow.enabled)
  assert.ok(await page.$eval('#admin-test', el => el.textContent.includes('用户自配通道')))
  await clickText('#admin-test button', '改用官方通道')
  await page.waitForFunction(() => !window.mcpRow.enabled)
  assert.ok((await page.evaluate(() => window.lastConfirm)).includes('平台积分'))
  await page.evaluate(() => { window.mcpFail = true })
  await clickText('#admin-test button', '测试连接')
  await page.waitForSelector('#admin-test [role=alert]')
  assert.ok(await page.$eval('#admin-test [role=alert]', el => el.textContent.includes('Synthetic connection failure')))
  await page.screenshot({ path: output + '/light.png', fullPage: true })
  await (await page.$('#admin-test .mcp-panel')).screenshot({ path: output + '/settings-light.png' })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; window.fixtureI18n.global.locale = 'de-DE'; document.getElementById('admin-test').style.width = '380px' })
  await page.screenshot({ path: output + '/dark-german-narrow.png', fullPage: true })
  await (await page.$('#admin-test .mcp-panel')).screenshot({ path: output + '/settings-dark-german-narrow.png' })
  await page.evaluate(() => { window.fixtureI18n.global.locale = 'zh-CN'; document.getElementById('admin-test').style.width = '' })
  await clickText('#admin-test button', '添加连接')
  await page.waitForSelector('#admin-test .mcp-editor input')
  await page.type('#admin-test .mcp-editor input', 'Public MCP')
  await page.type('#admin-test input[type=url]', 'https://public.example/mcp')
  await clickText('#admin-test button', '保存')
  await page.waitForFunction(() => window.mcpRow.id === 'custom-1' && !document.querySelector('.mcp-editor'))
  assert.equal(await page.evaluate(() => window.mcpCalls.find(c => c.method === 'POST' && c.url.endsWith('/connections')).data.token), undefined)
  // Anonymous public endpoint may have no token: saved revision still exposes test/enable.
  await page.evaluate(() => { window.fixtureI18n.global.locale = 'zh-CN'; window.mcpRow.configured = false; window.mcpRow.revision = 2; window.mcpFail = false })
  await page.evaluate(() => document.querySelector('#admin-test .mcp-actions button:nth-child(2)').click())
  await page.waitForFunction(() => [...document.querySelectorAll('#admin-test button')].some(el => el.textContent === '测试连接' && !el.disabled))
  await clickText('#admin-test button', '测试连接')
  await page.waitForFunction(() => window.mcpRow.tested)
  await clickText('#admin-test button', '配置')
  await page.select('#admin-test select[name=mcp-auth]', 'bearer')
  await page.waitForSelector('#admin-test input[type=password]')
  await page.type('#admin-test input[type=password]', 'unsaved-account-token')
  await page.evaluate(() => { window.fixtureStorage.checkba_user = { id: 2002 }; window.mcpRow.revision = 0 })
  await page.waitForFunction(() => !document.querySelector('.mcp-editor'))
  assert.equal(await page.evaluate(() => window.mcpCalls.filter(c => c.data?.token === 'unsaved-account-token').length), 0)
  await clickText('#admin-test button', '配置')
  await page.select('#admin-test select[name=mcp-auth]', 'bearer')
  await page.waitForSelector('#admin-test input[type=password]')
  await page.type('#admin-test input[type=password]', 'delayed-account-token')
  await page.evaluate(() => { window.delayMcpSave = true })
  await clickText('#admin-test button', '保存')
  await page.waitForFunction(() => !!window.pendingMcpSave)
  await page.evaluate(() => { window.fixtureStorage.checkba_user = { id: 3003 }; window.pendingMcpSave() })
  await page.waitForFunction(() => !document.querySelector('.mcp-editor'))
  assert.equal(await page.evaluate(() => window.delayedScopeRejected), true)
  assert.ok(await page.evaluate(() => window.mcpCalls.filter(c => c.method !== 'GET').every(c => c.scope?.startsWith('scope:'))))
  await clickText('#admin-test button', '删除')
  await page.waitForFunction(() => !document.querySelector('#admin-test .mcp-card'))
  assert.equal(await page.evaluate(() => window.mcpCalls.some(c => c.method === 'DELETE')), true)
  const advancedChecks = await advancedMcpCases(page, output, clickText)
  await Promise.all(consoleReads)
  assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
  assert.ok(!logs.some(line => line.includes('synthetic-token') || line.includes('unsaved-account-token') || line.includes('delayed-account-token')), 'credentials never enter console output')
  assert.ok(!logs.some(line => /synthetic-(header|environment|import|oauth).*secret/.test(line)), 'advanced credentials never enter console output')
  console.log(JSON.stringify({ passed: true, output, advancedChecks, checks: ['three marketplace categories', 'real settings nav=mcp', 'save/test/enable/official switch', 'no-auth saved connection test', 'persistent failure', 'skill classification', 'account switch clears draft', 'German narrow dark layout', 'scope-bound delayed save', 'credential-free console', 'delete connection'] }))
} catch (e) { await page.screenshot({ path: output + '/failure.png', fullPage: true }); console.error(errors); throw e }
finally { await browser.close(); await server.close() }
