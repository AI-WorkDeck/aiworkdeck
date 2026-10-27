// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real LOWA + real semantic/writing/review hosts. Service replies are synthetic, not model evidence.
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { preflight, startServer, launchBrowser, loadPuppeteer, openEditor } from './_boot.mjs'

preflight()
const fontRoot = path.resolve(process.env.LOWA_ENGINE_DIR || 'dist/zetaoffice/lowa', '..')
const modules = ['composables/semanticWritingHost.js', 'composables/writingAssistanceHost.js',
  'composables/inlineReviewHost.js', 'utils/completionLexicon.js', 'utils/requireAccountCore.js',
  'utils/completionDetails.js', 'utils/insightDetail.js']
const output = process.env.LOWA_AUTOMATIC_OUTPUT || '/tmp/awd-automatic-writing-ui'
fs.mkdirSync(output, { recursive: true })
const server = await startServer({ extraFiles: {
  ...Object.fromEntries(modules.map(file => ['/src/' + file, path.resolve('src', file)])),
  ...Object.fromEntries(['cjk.ttc', 'cjk-serif.otf', 'cjk-kai.ttf', 'cjk-fangsong.ttf'].map(file => ['/' + file, path.join(fontRoot, file)])),
} })
const browser = await launchBrowser(await loadPuppeteer(), { headed: process.env.LOWA_HEADED === '1' })
let page
try {
  page = await openEditor(browser, { viewport: { width: 1440, height: 1050, deviceScaleFactor: 1 } })
  page.on('pageerror', error => console.error('PAGE ERROR:', error.message))
  const exec = (action, params = {}) => page.evaluate((action, params) => window.__loExecutor.executeCommand(action, params), action, params)
  const read = async () => (await exec('get_document_text', { __agent: true })).paragraphs.map(p => p.text).join('\n')
  await exec('set_revision_view', { mode: 'final' })
  await exec('set_chrome', { all: false })
  await page.evaluate(async () => {
    const [{ createSemanticWritingHost }, { createWritingAssistanceHost }, { createInlineReviewHost }] = await Promise.all([
      import('/src/composables/semanticWritingHost.js'), import('/src/composables/writingAssistanceHost.js'),
      import('/src/composables/inlineReviewHost.js'),
    ])
    const banner = document.createElement('div')
    banner.textContent = '隔离合成测试 · 真实 LOWA + 真实宿主逻辑 · 服务响应为夹具，非模型实测'
    Object.assign(banner.style, { position: 'fixed', left: '12px', top: '8px', zIndex: '2147482700',
      padding: '8px 12px', borderRadius: '6px', background: '#fff0ba', color: '#5d4916', font: '13px sans-serif' })
    document.body.append(banner)
    const store = new Map([['awd_writing_preferences_fixture', { enabled: true, learning: false, hints: false }],
      ['awd_ai_review_fixture', { ai: false, hidden: false }]])
    const storage = { get: key => store.get(key), set: (key, value) => store.set(key, { ...value }) }
    const send = message => window.postMessage(message, location.origin)
    const execute = async (action, params) => {
      const result = await window.__loExecutor.executeCommand(action, params)
      if (action === 'accept_writing_suggestion') window.__autoTrace.push({ action, result })
      return result
    }
    window.__autoTrace = []
    window.__autoRequests = []
    window.__autoCancelled = []
    window.__delayAutomatic = false
    const jobs = new Map()
    let writing, review
    window.__newAutomaticFixture = async () => {
      writing?.destroy(); review?.destroy()
      window.__pendingAutomatic = null
      const semantic = createSemanticWritingHost({ projectId: 999, fileId: 999, title: '合成核查说明', writable: true, execute, send,
        api: {
          settings: async () => ({ files: [] }), saveSettings: async (_, data) => data,
          suggest: async (_, request) => {
            const id = 'synthetic-' + (window.__autoRequests.length + 1)
            const text = '相关材料仍需进一步核实。'
            const view = { id, status: 'READY', advice: [{ text, explanation: '合成测试仅验证交互链路。', factIds: [], sourceIds: [] }], facts: [], sources: [] }
            jobs.set(id, { request, view, text })
            window.__autoRequests.push({ id, ...request })
            if (window.__delayAutomatic) await new Promise(resolve => { window.__pendingAutomatic = { id, resolve } })
            return view
          },
          get: async (_, id) => jobs.get(id).view,
          cancel: async (_, id) => { window.__autoCancelled.push(id); return { status: 'CANCELLED' } },
          accept: async (_, id) => {
            const job = jobs.get(id)
            window.__autoTrace.push({ action: 'server-accept', id })
            return { text: job.text, revision: job.request.context.revision, selection: job.request.context.selection }
          },
        },
      })
      writing = createWritingAssistanceHost({ projectId: 999, fileId: 999, userId: 'fixture', writable: true,
        semantic, execute, send, storage,
        onState: state => { window.__autocompleteState = state; send({ __lo: 'lo-relay', type: 'writing-assistance-preferences-state', ...state }) },
        api: { list: async () => ({ items: [{ text: '北京当红晴天律师事务所', kind: 'COMPANY', source: 'variable', scope: 'project', uses: 3 }] }),
          learn: async () => { throw new Error('This isolated test must not learn or persist vocabulary') } },
      })
      review = createInlineReviewHost({ projectId: 999, fileId: 999, userId: 'fixture', writable: true,
        execute, send, storage, review: async () => ({ findings: [] }), onState: state => { window.__reviewState = state } })
      await writing.start(); review.start()
    }
    window.addEventListener('message', event => {
      const message = event.data
      if (message?.__lo !== 'lo-relay') return
      if (message.type === 'modified') { writing?.modified(); review?.modified(); return }
      if (message.type === 'writing-request') {
        window.__autoTrace.push({ action: message.action, session: message.session })
        writing?.handle(message)
      }
      if (message.type === 'inline-review-request') {
        if (message.action === 'autocomplete') {
          if (message.session === review?.session && message.data?.writingSession === writing?.session) writing.setEnabled(message.data.enabled)
        } else review?.handle(message)
      }
    })
    await window.__newAutomaticFixture()
  })
  const clearDocument = async () => {
    await exec('ui_command', { name: 'select_all' }); await exec('replace_selection', { text: '' })
    await exec('collapse_selection', { to: 'end' })
    await page.focus('input[data-lo-ime]')
  }
  const ime = value => page.evaluate(value => {
    const input = document.querySelector('input[data-lo-ime]')
    input.focus()
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.dispatchEvent(new CompositionEvent('compositionend', { data: value, bubbles: true }))
    input.dispatchEvent(new InputEvent('input', { data: value, inputType: 'insertCompositionText', bubbles: true }))
  }, value)
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const screenshot = name => page.screenshot({ path: path.join(output, name + '.png') })
  const openMenu = async () => {
    if (await page.$eval('.awd-ir-menu', node => node.hidden)) await page.click('.awd-ir-more')
    await page.waitForFunction(() => !document.querySelector('.awd-ir-menu').hidden)
  }
  const toggleAutomatic = async enabled => {
    await openMenu()
    assert.equal(await page.$eval('.awd-ir-autocomplete-toggle', node => node.textContent), enabled ? '开启自动补全' : '关闭自动补全')
    await page.click('.awd-ir-autocomplete-toggle')
    await page.waitForFunction(enabled => window.__autocompleteState?.enabled === enabled, {}, enabled)
  }
  const closeMenu = async () => {
    if (!(await page.$eval('.awd-ir-menu', node => node.hidden))) await page.click('.awd-ir-more')
    await page.focus('input[data-lo-ime]')
  }

  await clearDocument()
  const prefix = '对于本次股权收购项目的业务资质文件核查情况，我们认为'
  assert.ok(prefix.length >= 20)
  await ime(prefix)
  await page.waitForSelector('[role=option]', { timeout: 15000 })
  assert.equal(await read(), prefix, 'a displayed suggestion must not edit text')
  assert.equal(await page.evaluate(() => window.__autoRequests[0].mode), 'autocomplete')
  assert.ok(await page.evaluate(() => window.__autoRequests[0].context.before.includes('业务资质文件')))
  assert.equal(await page.$$eval('[role=option]', nodes => nodes.length), 1)
  await screenshot('01-context-suggestion')
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => document.querySelector('.awd-wa-panel').hidden)
  await page.waitForFunction(async expected => (await window.__loExecutor.executeCommand('get_document_text', { __agent: true }))
    .paragraphs.map(p => p.text).join('\n') === expected, { timeout: 10000 }, prefix + '相关材料仍需进一步核实。')
  assert.equal(await read(), prefix + '相关材料仍需进一步核实。')
  assert.equal(await page.evaluate(() => window.__autoTrace.filter(item => item.action === 'server-accept').length), 1)
  await screenshot('02-tab-accepted')
  await exec('undo')
  assert.equal(await read(), prefix, 'one undo must revert the complete accepted semantic suffix')

  await toggleAutomatic(false)
  assert.equal(await page.evaluate(() => window.__reviewState.ai), false, 'autocomplete is independent of AI review')
  await screenshot('03-disabled-shared-menu')
  await page.evaluate(() => [...document.querySelectorAll('.awd-ir-menu button')].find(node => node.textContent === '收起到边缘').click())
  await page.waitForFunction(() => !document.querySelector('.awd-ir-dock').hidden)
  assert.equal(await page.evaluate(() => window.__autocompleteState.enabled), false)
  await screenshot('04-collapsed-entry')
  await page.click('.awd-ir-dock')
  await page.waitForFunction(() => !document.querySelector('.awd-ir-ball').hidden)

  // A fresh real host/guest session avoids the earlier suggestion's cooldown masking the off guard.
  await clearDocument(); await page.evaluate(() => window.__newAutomaticFixture())
  const offCount = await page.evaluate(() => window.__autoRequests.length)
  await ime(prefix); await pause(2400)
  assert.equal(await page.$('[role=option]'), null)
  assert.equal(await page.evaluate(() => window.__autoRequests.length), offCount, 'off survives the new document session')

  await toggleAutomatic(true); await closeMenu()
  await clearDocument()
  await page.evaluate(() => { window.__delayAutomatic = true })
  await ime('关于交易文件及取得材料之间存在的具体差异，需要继续核对')
  await page.waitForFunction(() => !!window.__pendingAutomatic, { timeout: 15000 })
  const pendingId = await page.evaluate(() => window.__pendingAutomatic.id)
  await toggleAutomatic(false)
  await page.evaluate(() => { window.__delayAutomatic = false; window.__pendingAutomatic.resolve() })
  await page.waitForFunction(id => window.__autoCancelled.includes(id), {}, pendingId)
  await pause(500)
  assert.equal(await page.$('[role=option]'), null, 'late generated content cannot appear after disabling')
  await screenshot('05-disabled-in-flight')
  await closeMenu()

  await clearDocument(); await ime('北京当红'); await pause(2300)
  assert.equal(await page.$('[role=option]'), null, 'vocabulary remains manual')
  await page.keyboard.down('Alt'); await page.keyboard.press('Slash'); await page.keyboard.up('Alt')
  await page.waitForSelector('[role=option]', { timeout: 10000 })
  assert.ok(await page.$eval('[role=option]', node => node.textContent.includes('北京当红晴天律师事务所')))
  await screenshot('06-manual-vocabulary')
  await page.keyboard.press('Escape')
  assert.equal(await read(), '北京当红')
  fs.writeFileSync(path.join(output, 'trace.json'), JSON.stringify(await page.evaluate(() => ({ requests: window.__autoRequests,
    actions: window.__autoTrace, cancelled: window.__autoCancelled })), null, 2))
  console.log('PASS: real LOWA IME >=20 characters -> autocomplete-mode synthetic service -> one suggestion -> Tab -> one Undo; shared independent off/on, collapsed recovery, in-flight cancellation, vocabulary only on Alt+/. Not a model-quality test. Screenshots: ' + output)
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    console.error('Diagnostic:', JSON.stringify(await page.evaluate(() => ({ requests: window.__autoRequests, actions: window.__autoTrace,
      state: window.__autocompleteState, panel: document.querySelector('.awd-wa-panel')?.textContent, focus: document.activeElement?.outerHTML,
    })).catch(() => ({}))))
  }
  throw error
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
