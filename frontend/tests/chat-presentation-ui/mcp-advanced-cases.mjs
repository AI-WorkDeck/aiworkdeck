// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Extend the real marketplace → AdminPane fixture with advanced MCP HTTP responses.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'

export async function advancedMcpCases(page, output, clickText) {
  const btn = text => clickText('#admin-test button', text)
  const cardBtn = (id, text) => clickText(`#admin-test [data-connection-id="${id}"] button`, text)
  const fill = async (selector, value) => page.$eval(selector, (el, text) => { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })) }, value)
  const field = name => `#admin-test [name="mcp-${name}"]`
  const openAdvanced = async () => {
    await page.$eval('#admin-test .mcp-advanced summary', el => el.click())
    await page.waitForFunction(() => document.querySelector('#admin-test .mcp-advanced')?.open)
  }
  const waitIdle = () => page.waitForFunction(() => !document.querySelector('#admin-test .mcp-panel > [role=status]')?.textContent.includes('加载'))
  await page.evaluate(() => {
    const original = uni.request
    window.advancedMcp = { rows: [{ id: 'notion', presetId: 'notion', name: 'Notion', url: 'https://example.invalid/notion', transport: 'streamable-http', authType: 'oauth2', source: 'disabled', saved: false, revision: 0 }], calls: [], stdioAvailable: true, modalAccepted: true, browserFailure: true, browserOpened: [], nextId: 1 }
    const state = window.advancedMcp
    window.checkbaDesktop = { shell: { openExternal: async url => {
      if (state.browserFailure) return { ok: false }
      state.browserOpened.push(url); return { ok: true }
    } } }
    uni.showModal = options => { state.lastConfirm = options.content; options.success({ confirm: state.modalAccepted }) }
    uni.request = options => {
      if (!options.url.includes('/api/mcp/')) return original(options)
      const method = options.method || 'GET', path = new URL(options.url).pathname, data = options.data || {}
      state.calls.push({ method, path, data: JSON.parse(JSON.stringify(data)), scope: options.header?.['X-MCP-Scope'] })
      const scopeToken = 'scope:' + window.fixtureStorage.checkba_user.id
      const ok = payload => options.success({ statusCode: 200, data: { code: 0, ...structuredClone(payload) } })
      const fail = message => options.success({ statusCode: 200, data: { code: 1, message } })
      if (method !== 'GET' && options.header?.['X-MCP-Scope'] !== scopeToken) return fail('Scope changed')
      const list = () => ok({ scopeToken, connections: state.rows, presets: [], stdioAvailable: state.stdioAvailable })
      if (path.endsWith('/import/preview')) {
        const response = () => ok({ entries: [
          { index: 0, name: 'Imported remote', transport: 'streamable-http', url: 'https://example.invalid/import', authType: 'bearer', secretFields: ['token'], warnings: [] },
          { index: 1, name: 'Imported local', transport: 'stdio', command: 'node', args: ['test-server.mjs'], cwd: '/tmp/synthetic-import', secretFields: ['env.SYNTHETIC_IMPORT_SECRET'], warnings: [] },
        ], errors: [{ index: 2, name: 'Invalid entry', message: 'Synthetic invalid entry' }] })
        if (state.holdPreview) { state.releasePreview = response; return {} }
        return response()
      }
      if (path.endsWith('/import')) {
        const rows = data.selectedIndices.map(index => ({ id: 'import-' + index, name: index ? 'Imported local' : 'Imported remote', transport: index ? 'stdio' : 'streamable-http', url: index ? '' : 'https://example.invalid/import', command: index ? 'node' : '', args: index ? ['test-server.mjs'] : [], source: 'disabled', revision: 1, saved: true, enabled: false, tested: false, authType: index ? 'none' : 'bearer', environmentKeys: index ? ['SYNTHETIC_IMPORT_SECRET'] : [] }))
        state.rows.push(...rows); return ok({ connections: rows })
      }
      const id = path.split('/')[4], row = state.rows.find(item => item.id === id)
      if (path.endsWith('/oauth/authorize')) {
        row.oauthStatus = { pending: true, connected: false }; row.tested = false; row.enabled = false
        return ok({ authorizationUrl: 'https://example.invalid/oauth?state=synthetic-state', scopes: ['read'] })
      }
      if (path.endsWith('/oauth') && method === 'DELETE') { row.oauthStatus = { pending: false, connected: false }; row.enabled = false; row.tested = false; return ok({}) }
      if (path.endsWith('/test')) {
        if (data.expectedRevision !== row.revision) return fail('Synthetic revision changed; refresh and retry')
        if (row.transport === 'stdio' && !state.stdioAvailable) return fail('Synthetic server mode unavailable')
        if (row.transport === 'stdio' && !row.localApproved && data.allowLocalExecution !== true) return fail('Synthetic approval required')
        row.localApproved = row.transport === 'stdio'; row.tested = true; row.tools = [{ name: 'synthetic_tool', description: 'Synthetic tool' }]; return ok({})
      }
      if (path.endsWith('/enable')) { row.enabled = data.enabled; row.source = row.enabled ? 'custom' : 'disabled'; return ok({}) }
      if (path.endsWith('/connections') && method === 'POST' || method === 'PUT') {
        const next = row || { id: 'advanced-' + state.nextId++, revision: 0, saved: true, source: 'disabled' }
        for (const key of ['name', 'transport', 'url', 'authType', 'command', 'args', 'cwd', 'timeoutSeconds', 'oauthClientId', 'oauthScopes']) if (data[key] !== undefined) next[key] = data[key]
        for (const [field, names] of [['env', 'environmentKeys'], ['headers', 'headerNames']]) {
          const keys = new Set(next[names] || [])
          for (const [key, value] of Object.entries(data[field] || {})) value === null ? keys.delete(key) : keys.add(key)
          next[names] = [...keys]
        }
        next.revision++; next.tested = false; next.enabled = false; next.localApproved = false
        if (next.authType === 'oauth2') next.oauthStatus = { pending: false, connected: false }
        if (!row) state.rows.push(next)
        return ok({ connection: next })
      }
      if (method === 'DELETE') { state.rows = state.rows.filter(item => item.id !== id); return ok({}) }
      if (state.holdList) { const snapshot = structuredClone({ scopeToken, connections: state.rows, stdioAvailable: state.stdioAvailable }); state.releaseList = () => ok(snapshot); return {} }
      return list()
    }
  })
  await btn('刷新连接'); await waitIdle()
  assert.equal(await page.$$eval('[data-connection-id="notion"] button', rows => rows.find(b => b.textContent === '前往浏览器授权').disabled), true, 'an unsaved OAuth preset must be configured before authorization')
  assert.ok((await page.$eval('[data-connection-id="notion"]', el => el.textContent)).includes('请先配置并保存'))
  await btn('添加连接')
  await fill(field('name'), 'Headers MCP'); await fill(field('url'), 'https://example.invalid/headers')
  await openAdvanced()
  assert.equal(await page.$(field('timeout')), null, 'HTTP exposes no ineffective timeout setting')
  await btn('添加字段')
  await fill('#admin-test .mcp-pair input:first-child', 'X-Synthetic-Secret')
  await fill('#admin-test .mcp-pair input[type=password]', 'synthetic-header-secret')
  await btn('保存')
  await page.waitForSelector('[data-connection-id="advanced-1"]')
  assert.equal(await page.evaluate(() => window.advancedMcp.calls.some(c => c.path.endsWith('/test') || c.path.endsWith('/enable') || c.path.endsWith('/authorize'))), false, 'save never executes or authorizes')
  await cardBtn('advanced-1', '配置')
  await openAdvanced()
  assert.equal(await page.$eval('#admin-test .mcp-pair input[type=password]', el => el.value), '', 'saved header value never returns to the UI')
  await clickText('#admin-test .mcp-pair button', '删除')
  assert.equal(await page.$eval('#admin-test .mcp-pair input[type=password]', el => el.disabled), true)
  await clickText('#admin-test .mcp-pair button', '取消')
  await btn('保存')
  await page.waitForFunction(() => !document.querySelector('.mcp-editor'))
  assert.deepEqual(await page.evaluate(() => window.advancedMcp.calls.filter(c => c.method === 'PUT').at(-1).data.headers), {}, 'blank keeps the existing key')
  await cardBtn('advanced-1', '配置'); await openAdvanced()
  await clickText('#admin-test .mcp-pair button', '删除'); await btn('保存')
  await page.waitForFunction(() => !document.querySelector('.mcp-editor'))
  assert.deepEqual(await page.evaluate(() => window.advancedMcp.calls.filter(c => c.method === 'PUT').at(-1).data.headers), { 'X-Synthetic-Secret': null }, 'deletion is explicit and only sent on save')

  await btn('添加连接'); await fill(field('name'), 'Local MCP'); await page.select(field('transport'), 'stdio')
  await fill(field('command'), 'node'); await fill(field('args'), '[true]'); await fill(field('cwd'), '/tmp/synthetic-mcp')
  await btn('保存'); await page.waitForSelector('#admin-test [role=alert]')
  assert.ok((await page.$eval('#admin-test [role=alert]', el => el.textContent)).includes('JSON'))
  await fill(field('args'), '["test-server.mjs", "--read-only"]')
  await openAdvanced(); await btn('添加字段')
  await fill('#admin-test .mcp-pair input:first-child', 'SYNTHETIC_ENV')
  await fill('#admin-test .mcp-pair input[type=password]', 'synthetic-environment-secret')
  await btn('保存'); await page.waitForSelector('[data-connection-id="advanced-2"]')
  await page.evaluate(() => { window.advancedMcp.modalAccepted = false })
  await cardBtn('advanced-2', '测试连接')
  assert.equal(await page.evaluate(() => window.advancedMcp.calls.some(c => c.path.endsWith('/test'))), false, 'cancelled local confirmation never executes')
  assert.ok((await page.evaluate(() => window.advancedMcp.lastConfirm)).includes('node "test-server.mjs" "--read-only"'))
  assert.ok(!(await page.evaluate(() => window.advancedMcp.lastConfirm)).includes('synthetic-environment-secret'))
  await page.evaluate(() => { window.advancedMcp.modalAccepted = true })
  await cardBtn('advanced-2', '测试连接')
  await page.waitForFunction(() => window.advancedMcp.rows.find(r => r.id === 'advanced-2').tested)
  assert.deepEqual(await page.evaluate(() => window.advancedMcp.calls.find(c => c.path.endsWith('/test')).data), { expectedRevision: 1, allowLocalExecution: true })
  // Replacing a connection from another view after confirmation is rejected by revision.
  await page.evaluate(() => { const r = window.advancedMcp.rows.find(r => r.id === 'advanced-2'); r.revision++; r.localApproved = false })
  await cardBtn('advanced-2', '测试连接'); await page.waitForSelector('#admin-test [role=alert]')
  assert.ok((await page.$eval('#admin-test [role=alert]', el => el.textContent)).includes('revision changed'))
  await page.evaluate(() => { window.advancedMcp.stdioAvailable = false })
  await btn('刷新连接'); await waitIdle()
  assert.equal(await page.$$eval('[data-connection-id="advanced-2"] button', rows => rows.find(b => b.textContent === '测试连接').disabled), true)
  assert.ok((await page.$eval('[data-connection-id="advanced-2"]', el => el.textContent)).includes('当前服务器模式'))
  await page.evaluate(() => { window.advancedMcp.stdioAvailable = true })
  await btn('刷新连接'); await waitIdle()

  const importJson = JSON.stringify({ mcpServers: { remote: { url: 'https://example.invalid/import', headers: { Authorization: 'Bearer synthetic-import-secret' } }, local: { command: 'node', args: ['test-server.mjs'], env: { SYNTHETIC_IMPORT_SECRET: 'synthetic-import-env-secret' } }, invalid: {} } })
  await btn('导入 JSON'); await fill('#admin-test .mcp-import textarea', importJson); await btn('预览导入')
  await page.waitForSelector('#admin-test .mcp-preview')
  assert.equal(await page.$$eval('#admin-test .mcp-preview input[type=checkbox]', rows => rows.length), 2)
  const previewText = await page.$eval('#admin-test .mcp-preview', el => el.textContent)
  assert.ok(!previewText.includes('synthetic-import-secret'))
  assert.ok(previewText.includes('https://example.invalid/import'))
  assert.ok(previewText.includes('node "test-server.mjs"'))
  assert.ok(previewText.includes('/tmp/synthetic-import'))
  assert.ok((await page.$eval('#admin-test .mcp-preview', el => el.textContent)).includes('Synthetic invalid entry'))
  await page.$eval('#admin-test .mcp-preview input[type=checkbox]', el => el.click())
  await page.waitForFunction(() => [...document.querySelectorAll('#admin-test .mcp-preview input[type=checkbox]')].filter(el => el.checked).length === 1)
  const executionCount = await page.evaluate(() => window.advancedMcp.calls.filter(c => /\/(test|enable|authorize)$/.test(c.path)).length)
  await btn('导入所选（1）'); await page.waitForSelector('[data-connection-id="import-1"]')
  assert.equal(await page.$('#admin-test .mcp-import'), null)
  assert.deepEqual(await page.evaluate(() => window.advancedMcp.calls.find(c => c.path.endsWith('/import')).data.selectedIndices), [1])
  assert.equal(await page.evaluate(() => window.advancedMcp.calls.filter(c => /\/(test|enable|authorize)$/.test(c.path)).length), executionCount)
  assert.equal(await page.evaluate(() => Object.values(localStorage).concat(Object.values(sessionStorage)).some(v => /synthetic-import/.test(v))), false)
  // Local file selection reaches the same preview without persisting raw JSON.
  const filePath = output + '/synthetic-vscode-mcp.json'
  writeFileSync(filePath, JSON.stringify({ servers: { remote: { type: 'http', url: 'https://example.invalid/vscode' } } }))
  const oversizedFile = output + '/synthetic-oversized-mcp.json'
  writeFileSync(oversizedFile, ' '.repeat(512 * 1024 + 1))
  await btn('导入 JSON'); await (await page.$('#admin-test input[type=file]')).uploadFile(oversizedFile)
  await page.waitForFunction(() => document.querySelector('#admin-test [role=alert]')?.textContent.includes('512 KiB'))
  assert.equal(await page.$eval('#admin-test .mcp-import textarea', el => el.value), '')
  await (await page.$('#admin-test input[type=file]')).uploadFile(filePath)
  await page.waitForFunction(() => document.querySelector('#admin-test .mcp-import textarea').value.includes('servers'))
  await btn('预览导入'); await page.waitForSelector('.mcp-preview')
  await page.evaluate(() => { window.fixtureStorage.checkba_user = { id: 4004 } })
  await page.waitForFunction(() => !document.querySelector('.mcp-import'))
  // A preview from the previous account cannot resurrect selected entries or raw JSON.
  await btn('导入 JSON'); await fill('#admin-test .mcp-import textarea', importJson)
  await page.evaluate(() => { window.advancedMcp.holdPreview = true })
  await btn('预览导入'); await page.waitForFunction(() => !!window.advancedMcp.releasePreview)
  await page.evaluate(() => { window.fixtureStorage.checkba_user = { id: 5005 } })
  await page.waitForFunction(() => !document.querySelector('.mcp-import'))
  await page.evaluate(() => { window.advancedMcp.releasePreview(); window.advancedMcp.holdPreview = false })
  assert.equal(await page.$('.mcp-preview'), null)

  await btn('添加连接'); await fill(field('name'), 'OAuth MCP'); await fill(field('url'), 'https://example.invalid/oauth-mcp')
  await page.select(field('auth'), 'oauth2'); await openAdvanced()
  await fill(field('client-id'), 'synthetic-client'); await fill(field('client-secret'), 'synthetic-oauth-secret'); await fill(field('scopes'), 'read write')
  await btn('保存'); await page.waitForSelector('[data-connection-id="advanced-3"]')
  await cardBtn('advanced-3', '配置'); await openAdvanced()
  assert.equal(await page.$eval(field('client-id'), el => el.value), 'synthetic-client')
  assert.equal(await page.$eval(field('scopes'), el => el.value), 'read write')
  assert.equal(await page.$eval(field('client-secret'), el => el.value), '')
  await fill(field('client-id'), ''); await fill(field('scopes'), ''); await btn('保存')
  await page.waitForFunction(() => !document.querySelector('.mcp-editor'))
  assert.equal(await page.evaluate(() => window.advancedMcp.calls.filter(c => c.method === 'PUT').at(-1).data.oauthClientId), '')
  assert.deepEqual(await page.evaluate(() => window.advancedMcp.calls.filter(c => c.method === 'PUT').at(-1).data.oauthScopes), [])
  assert.equal(await page.$$eval('[data-connection-id="advanced-3"] button', rows => rows.find(b => b.textContent === '测试连接').disabled), true)
  await cardBtn('advanced-3', '前往浏览器授权'); await page.waitForSelector('#admin-test [role=alert]')
  assert.ok((await page.$eval('#admin-test [role=alert]', el => el.textContent)).includes('浏览器未能打开'))
  assert.ok((await page.$eval('[data-connection-id="advanced-3"]', el => el.textContent)).includes('等待浏览器授权'))
  await page.evaluate(() => { window.advancedMcp.browserFailure = false })
  await cardBtn('advanced-3', '重新打开浏览器')
  assert.equal(await page.evaluate(() => window.advancedMcp.browserOpened.length), 1)
  await page.evaluate(() => { window.advancedMcp.rows.find(r => r.id === 'advanced-3').oauthStatus = { connected: true, pending: false } })
  await page.waitForFunction(() => document.querySelector('[data-connection-id="advanced-3"]').textContent.includes('OAuth 已连接'))
  await cardBtn('advanced-3', '测试连接'); await page.waitForFunction(() => window.advancedMcp.rows.find(r => r.id === 'advanced-3').tested)
  await cardBtn('advanced-3', '启用 AI 调用'); await page.waitForFunction(() => window.advancedMcp.rows.find(r => r.id === 'advanced-3').enabled)
  await cardBtn('advanced-3', '断开 OAuth'); await page.waitForFunction(() => !window.advancedMcp.rows.find(r => r.id === 'advanced-3').oauthStatus.connected)
  await cardBtn('advanced-3', '前往浏览器授权'); await page.waitForFunction(() => !!document.querySelector('[data-connection-id="advanced-3"]')?.textContent.includes('等待浏览器授权'))
  await cardBtn('advanced-3', '取消授权'); await page.waitForFunction(() => !document.querySelector('[data-connection-id="advanced-3"]').textContent.includes('等待浏览器授权'))
  const stoppedAt = await page.evaluate(() => window.advancedMcp.calls.length)
  await new Promise(resolve => setTimeout(resolve, 2400))
  assert.equal(await page.evaluate(() => window.advancedMcp.calls.length), stoppedAt, 'cancel stops OAuth polling')
  // Discard a late pending-status read after account switch.
  await cardBtn('advanced-3', '前往浏览器授权'); await page.waitForFunction(() => document.querySelector('[data-connection-id="advanced-3"]').textContent.includes('等待浏览器授权'))
  await page.evaluate(() => { window.advancedMcp.holdList = true })
  await page.waitForFunction(() => !!window.advancedMcp.releaseList)
  await page.evaluate(() => { window.fixtureStorage.checkba_user = { id: 6006 }; window.advancedMcp.rows = []; window.advancedMcp.holdList = false })
  await page.waitForFunction(() => !document.querySelector('.mcp-card'))
  await page.evaluate(() => { window.advancedMcp.releaseList() })
  assert.equal(await page.$('.mcp-card'), null)
  await btn('导入 JSON')
  assert.equal(await page.$eval('#admin-test .mcp-import textarea', el => el.value), '')
  await btn('取消')
  // RTL, dark and narrow layouts exercise the complete advanced editor.
  await btn('添加连接'); await page.select(field('transport'), 'stdio'); await openAdvanced(); await btn('添加字段')
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.dir = 'rtl'; window.fixtureI18n.global.locale = 'ar-SA'; document.getElementById('admin-test').style.width = '340px'; document.getElementById('admin-test').style.height = '1800px' })
  await page.focus(field('name'))
  assert.equal(await page.$eval(field('name'), el => getComputedStyle(el).outlineStyle), 'solid', 'keyboard focus uses an existing visible theme token')
  await (await page.$('#admin-test .mcp-panel')).screenshot({ path: output + '/advanced-dark-arabic-narrow.png' })
  assert.equal(await page.$eval('.mcp-panel', el => el.scrollWidth <= el.clientWidth), true, 'RTL narrow panel has no horizontal overflow')
  assert.ok(!(await page.$eval('#admin-test .mcp-panel', el => el.textContent)).includes('mcp.'), 'Arabic tokens resolve')
  await page.evaluate(() => { document.documentElement.dir = 'ltr'; document.documentElement.dataset.theme = 'light'; window.fixtureI18n.global.locale = 'zh-CN'; document.getElementById('admin-test').style.width = '560px' })
  await (await page.$('#admin-test .mcp-panel')).screenshot({ path: output + '/advanced-light-editor.png' })
  assert.equal(await page.evaluate(() => window.advancedMcp.calls.filter(c => c.method !== 'GET').every(c => c.scope?.startsWith('scope:'))), true, 'all advanced writes carry scope')
  return ['unsaved OAuth preset cannot authorize', 'write-only header edit and explicit removal', 'stdio JSON validation', 'local confirmation and rejection', 'revision-bound local approval', 'server-mode disabled', 'selected valid import only', 'file import and size limit', 'no import side effects', 'late preview account switch', 'OAuth browser failure/reopen', 'saved OAuth client ID/scopes edit and reset', 'OAuth polling and test/enable', 'OAuth cancel/disconnect', 'late OAuth status account switch', 'Arabic narrow dark layout']
}
