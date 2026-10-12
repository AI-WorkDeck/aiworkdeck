// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real LOWA and production hosts, synthetic local vocabulary. No paid models or user documents.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { preflight, startServer, launchBrowser, loadPuppeteer, openEditor } from './_boot.mjs'

preflight()
const modules = ['composables/writingAssistanceHost.js', 'composables/inlineReviewHost.js',
  'utils/completionLexicon.js', 'utils/requireAccountCore.js', 'utils/completionDetails.js', 'utils/insightDetail.js']
const fontRoot = path.resolve(process.env.LOWA_ENGINE_DIR || 'dist/zetaoffice/lowa', '..')
const output = process.env.LOWA_CONTROLS_OUTPUT || '/tmp/awd-1226-controls-ui'
fs.mkdirSync(output, { recursive: true })
const server = await startServer({ extraFiles: {
  ...Object.fromEntries(modules.map(file => ['/src/' + file, path.resolve('src', file)])),
  ...Object.fromEntries(['cjk.ttc', 'cjk-serif.otf', 'cjk-kai.ttf', 'cjk-fangsong.ttf'].map(file => ['/' + file, path.join(fontRoot, file)])),
} })
const browser = await launchBrowser(await loadPuppeteer(), { headed: process.env.LOWA_HEADED === '1' })
let page
try {
  page = await openEditor(browser, { viewport: { width: 1440, height: 1050, deviceScaleFactor: 1 } })
  const exec = (action, params = {}) => page.evaluate((action, params) => window.__loExecutor.executeCommand(action, params), action, params)
  const read = async () => (await exec('get_document_text', { __agent: true })).paragraphs.map(p => p.text).join('\n')
  await exec('set_revision_view', { mode: 'final' }); await exec('set_chrome', { all: false })
  await page.evaluate(async () => {
    const [{ createWritingAssistanceHost }, { createInlineReviewHost }] = await Promise.all([
      import('/src/composables/writingAssistanceHost.js'), import('/src/composables/inlineReviewHost.js'),
    ])
    const banner = document.createElement('div')
    banner.textContent = '隔离合成测试 · 真实 LOWA 与宿主 · 本地词库开关，未调用模型'
    Object.assign(banner.style, { position: 'fixed', left: '12px', top: '8px', zIndex: '2147482700',
      padding: '8px 12px', background: '#fff0ba', color: '#5d4916', font: '13px sans-serif' })
    document.body.append(banner)
    const store = new Map([['awd_writing_preferences_controls-fixture', { enabled: true, learning: false, hints: false }],
      ['awd_ai_review_controls-fixture', { ai: false, hidden: false }]])
    const storage = { get: key => store.get(key), set: (key, value) => store.set(key, { ...value }) }
    const send = message => window.postMessage(message, location.origin)
    const execute = (action, params) => window.__loExecutor.executeCommand(action, params)
    window.__controlsActions = []
    let writing, review
    window.__newControlsFixture = async () => {
      writing?.destroy(); review?.destroy()
      writing = createWritingAssistanceHost({ projectId: 999, fileId: 999, userId: 'controls-fixture', writable: true,
        execute, send, storage, onState: state => { window.__controlsState = state; send({ __lo: 'lo-relay', type: 'writing-assistance-preferences-state', ...state }) },
        api: { list: async () => ({ items: [{ text: '北京当红晴天律师事务所', kind: 'COMPANY', source: 'variable', scope: 'project', uses: 3 }] }),
          learn: async () => { throw new Error('Learning must remain disabled in this isolated fixture') } },
      })
      review = createInlineReviewHost({ projectId: 999, fileId: 999, userId: 'controls-fixture', writable: true,
        execute, send, storage, review: async () => ({ findings: [] }), onState: state => { window.__reviewState = state } })
      await writing.start(); review.start()
    }
    window.addEventListener('message', event => {
      const m = event.data
      if (m?.__lo !== 'lo-relay') return
      if (m.type === 'modified') { writing?.modified(); review?.modified() }
      if (m.type === 'writing-request') { window.__controlsActions.push(m.action); writing?.handle(m) }
      if (m.type === 'inline-review-request') {
        if (m.action === 'autocomplete') {
          if (m.session === review?.session && m.data?.writingSession === writing?.session && typeof m.data?.enabled === 'boolean') writing.setEnabled(m.data.enabled)
        } else review?.handle(m)
      }
    })
    await window.__newControlsFixture()
  })
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const screenshot = name => page.screenshot({ path: path.join(output, name + '.png') })
  const reset = async () => {
    await exec('ui_command', { name: 'select_all' }); await exec('replace_selection', { text: '' })
    await exec('collapse_selection', { to: 'end' }); await page.focus('input[data-lo-ime]')
  }
  const ime = value => page.evaluate(value => {
    const input = document.querySelector('input[data-lo-ime]'); input.focus()
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input.dispatchEvent(new CompositionEvent('compositionend', { data: value, bubbles: true }))
    input.dispatchEvent(new InputEvent('input', { data: value, inputType: 'insertCompositionText', bubbles: true }))
  }, value)
  const clickText = (selector, text) => page.evaluate((selector, text) => {
    const button = [...document.querySelectorAll(selector)].find(node => node.textContent === text)
    if (!button) throw new Error('Button not found: ' + text)
    button.click()
  }, selector, text)
  const menu = async () => {
    if (await page.$eval('.awd-ir-menu', node => node.hidden)) await page.click('.awd-ir-more')
    await page.waitForFunction(() => !document.querySelector('.awd-ir-menu').hidden)
  }
  await reset(); await ime('北京当红')
  await page.waitForSelector('[role=option]', { timeout: 10000 })
  assert.equal(await read(), '北京当红')
  await screenshot('01-local-candidate')
  await clickText('.awd-wa-footer button', '关闭自动补全')
  await page.waitForFunction(() => window.__controlsState.enabled === false && document.querySelector('.awd-wa-panel').hidden)
  assert.equal(await page.evaluate(() => window.__reviewState.ai), false)
  await menu(); assert.equal(await page.$eval('.awd-ir-autocomplete-toggle', n => n.textContent), '开启自动补全')
  await screenshot('02-off-shared-menu')
  await clickText('.awd-ir-menu button', '收起到边缘')
  await page.waitForFunction(() => !document.querySelector('.awd-ir-dock').hidden)
  assert.equal(await page.evaluate(() => window.__controlsState.enabled), false)
  await screenshot('03-collapsed')
  await page.click('.awd-ir-dock'); await page.waitForFunction(() => !document.querySelector('.awd-ir-ball').hidden)
  await reset(); await page.evaluate(() => window.__newControlsFixture()); await ime('北京当红'); await pause(500)
  assert.equal(await page.$('[role=option]'), null, 'off survives a new host session and real typing')
  await page.keyboard.down('Alt'); await page.keyboard.press('Slash'); await page.keyboard.up('Alt')
  await page.waitForSelector('[role=option]', { timeout: 10000 })
  await screenshot('04-manual-while-off')
  await page.keyboard.press('Tab'); await page.waitForFunction(() => document.querySelector('.awd-wa-panel').hidden)
  assert.equal(await read(), '北京当红晴天律师事务所')
  assert.equal(await page.evaluate(() => window.__controlsState.enabled), false)
  await exec('undo'); assert.equal(await read(), '北京当红')
  await menu(); await page.click('.awd-ir-autocomplete-toggle')
  await page.waitForFunction(() => window.__controlsState.enabled === true)
  assert.equal(await page.evaluate(() => window.__reviewState.ai), false, 'reenabling autocomplete does not enable AI review')
  await screenshot('05-reenabled')
  await page.click('.awd-ir-more'); await reset(); await ime('北京当红')
  await page.waitForSelector('[role=option]', { timeout: 10000 })
  assert.equal(await read(), '北京当红')
  await screenshot('06-automatic-restored')
  const trace = await page.evaluate(() => ({ state: window.__controlsState, review: window.__reviewState, actions: window.__controlsActions }))
  assert.equal(trace.actions.some(action => action.startsWith('semantic-') || action === 'lookup'), false)
  fs.writeFileSync(path.join(output, 'trace.json'), JSON.stringify(trace, null, 2))
  console.log('PASS: real LOWA local candidates -> direct off -> disappear -> persisted off -> manual Tab/Undo -> shared-menu on -> candidates restored; collapsed recovery and AI review remain independent. No model calls. ' + output)
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
