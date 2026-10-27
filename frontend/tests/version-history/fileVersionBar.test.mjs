// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 编辑器只显示本文件的实际保存状态，版本提交与同步由全局版本控制面板管理。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { baseParse, compile } from '@vue/compiler-dom'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { alignProvenance, provenanceSummary } from '../../src/utils/provenanceAlign.js'
import zh from '../../src/locales/zh-CN/version.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const t = (key, params) => {
  const raw = zh[String(key).replace(/^version\./, '')]
  if (raw == null) throw new Error('缺文案: ' + key)
  return String(raw).replace(/\{(\w+)\}/g, (_, k) => String((params || {})[k]))
}

/** 读 .vue 的 <script>、把 import 换成可注入的桩（形制同 provenanceRefresh.test.mjs）。 */
function optionsOf(rel, stubs = {}) {
  const script = read(rel).match(/<script>([\s\S]*?)<\/script>/)[1]
  const names = []
  for (const m of script.matchAll(/^import\s+([\s\S]*?)\s+from\s+'[^']+'\s*;?\s*$/gm)) {
    const clause = m[1]
    const braced = clause.match(/\{([\s\S]*?)\}/)
    if (braced) {
      for (const part of braced[1].split(',')) {
        const name = part.split(/\s+as\s+/).pop().trim()
        if (name) names.push(name)
      }
    }
    const def = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim()
    if (def) names.push(def)
  }
  const body = script
    .replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '')
    .replace(/export\s+default\s*\{/, 'return {')
  return new Function(...names, body)(...names.map((n) => stubs[n] || (() => {})))
}

const editorWith = (stubs = {}) => optionsOf('../../src/components/LibreOfficeEditor.vue',
  { alignProvenance, provenanceSummary, ...stubs })

function saveContext(over = {}) {
  return {
    ready: true, file: { id: 5, fileSize: 100 }, projectId: 1,
    statusKey: 'ready', dirty: false, saving: false,
    backendSaveRetryReady: () => false, $t: k => k, ...over,
  }
}

test('真实保存栏模板只渲染本文件保存状态，版本信息不再占据正文上方', async () => {
  const source = read('../../src/components/LibreOfficeEditor.vue')
  const template = source.match(/<template>([\s\S]*?)<\/template>/)[1]
  const wrapper = baseParse(template).children.find(node => node.type === 1)
  const bar = wrapper.children.find(node => node.type === 1 && node.props.some(prop =>
    prop.name === 'class' && /libre-(save|prov)-bar/.test(prop.value?.content || '')))
  assert.ok(bar, '文件保存状态有固定入口')
  const render = new Function('Vue', compile(bar.loc.source, { mode: 'function', prefixIdentifiers: true, isCustomElement: () => true }).code)(Vue)
  for (const state of [
    { saveStateText: '已保存', statusKey: 'ready' },
    { saveStateText: '待保存', statusKey: 'ready' },
    { saveStateText: '保存失败', statusKey: 'saveFailed', isError: true },
  ]) {
    const app = Vue.createSSRApp({ render, setup: () => ({
      provenanceBarVisible: true, provText: '已保存，尚未存为版本', provSha: '', saving: false,
      isError: false, retrySave() {}, saveCopyAs() {}, openProvenanceHistory() {}, ...state,
    }) })
    app.config.globalProperties.$t = key => key === 'editor.retrySave' ? '重试保存' : key
    const html = await renderToString(app)
    assert.ok(html.includes(state.saveStateText), html)
    assert.doesNotMatch(html, /尚未存为版本|libre-prov-text/)
    if (state.isError) assert.ok(html.includes('重试保存'))
  }
  assert.match(template, /@tap="saveCopyAs"/)
})

test('版本接口更新与文件是否落盘无关：只认编辑器保存结果', async () => {
  let reply = { data: { versioned: true, dirty: true, fileVersion: null, units: [] } }
  const ed = editorWith({ getProvenance: () => Promise.resolve(reply) })
  const vm = saveContext({ reviewOpen: false })
  const saved = () => ed.computed.saveStateText.call(vm)
  await ed.methods.loadProvenance.call(vm)
  assert.equal(saved(), 'editor.status.saved', '文件已保存但尚未提交，不能提示未保存')

  vm.dirty = true
  reply = { data: { versioned: true, dirty: false, fileVersion: { sha: 'abc1234' }, units: [] } }
  await ed.methods.loadProvenance.call(vm)
  assert.equal(saved(), 'editor.status.pendingSave', '历史已提交也不能覆盖正文尚未落盘状态')
  vm.saving = true
  assert.equal(saved(), 'editor.status.saving')
  vm.saving = false
  vm.statusKey = 'saveFailed'
  assert.equal(saved(), 'editor.status.saveFailed', '失败后保留真实失败状态')
})

test('版本记录关闭、未知或请求失败都不会改变文件保存结果', async () => {
  const vm = saveContext({ reviewOpen: false })
  for (const getProvenance of [
    async () => ({ data: { versioned: false, units: [] } }),
    async () => ({ data: {} }),
    async () => { throw new Error('offline') },
  ]) {
    const ed = editorWith({ getProvenance })
    await ed.methods.loadProvenance.call(vm)
    assert.equal(ed.computed.saveStateText.call(vm), 'editor.status.saved')
  }
})

test('逐段溯源继续在审阅面板中显示，保留摘要与加载状态', () => {
  const ed = editorWith()
  const rows = [{ index: 0, text: '第一条', unit: { sha: 'abc1234', self: true } }]
  const panel = ed.computed.provenanceForPanel.call({
    provLoaded: true, provRows: rows, provTruncated: true, provLoading: false, $t: t,
  })
  assert.equal(panel.rows, rows)
  assert.ok(panel.summary)
  assert.equal(panel.truncated, true)
  assert.equal(panel.loading, false)
  assert.equal(ed.computed.provenanceForPanel.call({ provLoaded: false }), null)
})

test('审阅面板仍能打开指定段落的版本历史，没有版本标识时不误跳', () => {
  const ed = editorWith()
  const events = []
  const vm = { file: { id: 5 }, $emit: (...args) => events.push(args) }
  ed.methods.openProvenanceHistory.call(vm, { sha: 'abc1234' })
  ed.methods.openProvenanceHistory.call(vm, null)
  ed.methods.openProvenanceHistory.call(vm, {})
  assert.deepEqual(events, [['open-history', { sha: 'abc1234', fileId: 5 }]])
})

test('reviewOpen=false 时不拉全量段落，打开审阅面板时补齐对齐', async () => {
  const ed = editorWith({ getProvenance: async () => ({ data: {
    units: [{ key: 'p0', textHash: 'h' }], truncated: false, computing: false,
  } }) })
  let aligned = 0
  const vm = saveContext({
    reviewOpen: false, provLoading: false, provLoaded: false,
    $emit: () => {}, alignProvenanceRows: async () => { aligned++ },
  })
  await ed.methods.loadProvenance.call(vm)
  assert.equal(vm.provUnits.length, 1)
  assert.equal(aligned, 0)
  assert.equal(vm._provRowsPending, true)
  ed.watch.reviewOpen.call(vm, true)
  assert.equal(aligned, 1)
  assert.equal(vm._provRowsPending, false)
})
