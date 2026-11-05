// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 面板端到端（假宿主）：选文件 → 抽取 → 表格 → 点格子跳出处 → 确认/修改 → 导出 xlsx。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const { JSDOM } = (() => {
  try { return createRequire(new URL('../../../frontend/package.json', import.meta.url))('jsdom') } catch (e) { return createRequire(import.meta.url)('jsdom') }
})()
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const html = read('../web/index.html')
const scripts = ['../web/panel-l10n.js', '../web/review-core.js', '../web/xlsx.js'].map(read)
const panelSource = read('../web/panel.js')
const tick = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

const DOCS = {
  '合同/采购合同.docx': '采购合同\n甲方：北京某某科技有限公司\n乙方：上海某某贸易有限公司\n第九条 本合同适用中华人民共和国法律。',
  '合同/租赁合同.pdf': '租赁合同\n出租人：杭州某某置业有限公司\n承租人：北京某某科技有限公司'
}

async function panel({ saved = null, language = 'zh-CN' } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://plugin.invalid/' })
  const w = dom.window
  w.TextEncoder = TextEncoder
  const calls = []
  const store = new Map(saved ? [['review:5', saved]] : [])
  let aiCount = 0
  w.awd = {
    ready: async () => ({ projectId: '5', language }),
    events: { on() { return () => {} } },
    files: {
      list: async () => Object.keys(DOCS).map((path) => ({ path, name: path.split('/').pop() })).concat([{ path: '照片/现场.jpg', name: '现场.jpg' }]),
      read: async (path) => ({ path, content: DOCS[path], truncated: false })
    },
    storage: { get: async (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null), set: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))) } },
    ui: { progress() {} },
    ai: {
      request: async (prompt, opts) => {
        aiCount++
        assert.equal(opts.purpose, 'tabular-review')
        assert.ok(prompt.length + opts.system.length <= 16000)
        const isLease = prompt.includes('租赁合同')
        return JSON.stringify({ answers: [
          { id: 'parties', found: true, answer: isLease ? '杭州某某置业有限公司；北京某某科技有限公司' : '北京某某科技有限公司；上海某某贸易有限公司',
            quote: isLease ? '出租人：杭州某某置业有限公司' : '甲方：北京某某科技有限公司' },
          { id: 'governingLaw', found: !isLease, answer: isLease ? '' : '中国法', quote: isLease ? '' : '本合同适用中华人民共和国法律' },
          { id: 'signDate', found: true, answer: '2026-01-01', quote: '2026年1月1日签署' }
        ] })
      }
    },
    call: async (method, params) => { calls.push({ method, params }); return method === 'files.download' ? { started: true } : {} }
  }
  scripts.forEach((s) => w.eval(s))
  w.eval(panelSource)
  await tick()
  const $ = (id) => w.document.getElementById(id)
  const button = (label) => [...w.document.querySelectorAll('button')].find((b) => b.textContent === label)
  return { dom, w, $, calls, store, button, ai: () => aiCount }
}

const BUY = '合同/采购合同.docx'
const LEASE = '合同/租赁合同.pdf'
function cellButton(p, path, col) {
  const row = [...p.$('table-body').querySelectorAll('tr')].find((tr) => tr.querySelector('th').title === path)
  return row.querySelectorAll('.cell-btn')[col]
}

test('完整流程：选文件、抽取、表格状态、跳回原文、确认与修改、导出 xlsx', async (t) => {
  const p = await panel()
  t.after(() => p.dom.window.close())
  // 默认载入商业合同模板；图片文件不在可选列表里
  assert.equal(p.$('column-list').querySelectorAll('.column-item').length, 9)
  const boxes = p.$('file-list').querySelectorAll('input[type=checkbox]')
  assert.equal(boxes.length, 2)
  p.$('select-all').click()
  await tick()
  assert.equal(p.$('file-count').textContent, '已选 2 份')

  p.$('run').click()
  await tick()
  assert.equal(p.$('confirm').hidden, false)
  assert.match(p.$('confirm').textContent, /预计调用 AI 2 次/)
  assert.equal(p.ai(), 0, '确认之前不得调用 AI')
  p.button('开始').click()
  await tick(60)
  assert.equal(p.ai(), 2)

  const parties = cellButton(p, BUY, 0)
  assert.ok(parties.classList.contains('status-ai_draft'))
  assert.match(parties.textContent, /上海某某贸易有限公司/)
  assert.ok(cellButton(p, BUY, 1).classList.contains('status-unverified'), '编造的引文必须被拒')
  assert.ok(cellButton(p, BUY, 2).classList.contains('status-not_found'))
  assert.ok(cellButton(p, BUY, 8).classList.contains('status-ai_draft'))
  assert.ok(cellButton(p, LEASE, 8).classList.contains('status-not_found'))

  // 点格子 → 详情显示原文引文 → 跳到原文带定位符
  parties.click()
  await tick()
  assert.match(p.$('detail').querySelector('.detail-quote').textContent, /甲方：北京某某科技有限公司/)
  p.button('跳到原文').click()
  await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls.find((c) => c.method === 'ui.openFile').params)), { path: '合同/采购合同.docx', locator: { type: 'docx', quote: '甲方：北京某某科技有限公司' } })
  cellButton(p, LEASE, 0).click()
  await tick()
  p.button('跳到原文').click()
  await tick()
  assert.equal(p.calls.filter((c) => c.method === 'ui.openFile')[1].params.locator.type, 'pdf')

  // 确认第一格；修改租赁合同的主体
  cellButton(p, BUY, 0).click()
  await tick()
  p.button('确认').click()
  await tick()
  assert.ok(cellButton(p, BUY, 0).classList.contains('status-confirmed'))
  cellButton(p, LEASE, 0).click()
  await tick()
  p.button('修改').click()
  await tick()
  p.$('detail').querySelector('textarea').value = '出租人：杭州某某置业；承租人：北京某某科技'
  p.button('保存').click()
  await tick()
  assert.ok(cellButton(p, LEASE, 0).classList.contains('status-edited'))
  assert.match(p.$('detail').textContent, /AI 原答案：杭州某某置业有限公司/)
  const saved = p.store.get('review:5')
  assert.equal(saved.cells['合同/采购合同.docx'].parties.status, 'confirmed')
  assert.equal(saved.cells['合同/租赁合同.pdf'].parties.status, 'edited')

  // 导出
  p.$('export').click()
  await tick()
  const dl = p.calls.find((c) => c.method === 'files.download')
  assert.match(dl.params.name, /^表格化审阅-\d{8}-\d{4}\.xlsx$/)
  assert.ok(dl.params.data instanceof p.w.Uint8Array || dl.params.data instanceof Uint8Array)
  assert.equal(dl.params.data[0], 0x50)
  assert.equal(dl.params.data[1], 0x4b)
})

test('再次抽取只补未核验/失败的格子，律师确认过的不被覆盖；刷新后从存储恢复', async (t) => {
  const first = await panel()
  t.after(() => first.dom.window.close())
  first.$('select-all').click()
  first.$('run').click()
  await tick()
  first.button('开始').click()
  await tick(60)
  cellButton(first, BUY, 0).click()
  await tick()
  first.button('确认').click()
  await tick()

  const again = await panel({ saved: first.store.get('review:5') })
  t.after(() => again.dom.window.close())
  assert.ok(cellButton(again, BUY, 0).classList.contains('status-confirmed'))
  again.$('run').click()
  await tick()
  // 只有采购合同还有未核验的 signDate；租赁合同的 signDate 也未核验 → 两份都要再问
  assert.match(again.$('confirm').textContent, /预计调用 AI 2 次/)
  again.button('开始').click()
  await tick(60)
  assert.ok(cellButton(again, BUY, 0).classList.contains('status-confirmed'))
  assert.equal(again.store.get('review:5').cells['合同/采购合同.docx'].parties.status, 'confirmed')
})

test('英文界面走 l10n，旧宿主不支持导出时提示升级', async (t) => {
  const p = await panel({ language: 'en-US' })
  t.after(() => p.dom.window.close())
  assert.equal(p.$('run').textContent, 'Start extraction')
  assert.equal(p.$('table-head').querySelector('th').textContent, 'Document')
  p.w.awd.call = async () => { throw Object.assign(new Error('Unknown method'), { code: 'unknown_method' }) }
  p.$('select-all').click()
  await tick()
  p.$('export').click()
  await tick()
  assert.match(p.$('notice').textContent, /upgrade/i)
})
