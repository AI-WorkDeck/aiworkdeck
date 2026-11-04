// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import * as pricing from '../../src/utils/modelPricing.js'

const dom = new JSDOM('<body></body>')
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key]
const Vue = await import('vue')
const noop = () => {}
const stub = { render: () => null }
function component(file, bindings) {
  const { descriptor } = parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
  const script = descriptor.script.content.replace(/import[\s\S]*?from\s+['"][^'"]+['"]\s*\n/g, '').replace('export default', 'return')
  const result = new Function(...Object.keys(bindings), script)(...Object.values(bindings))
  result.render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)(Vue)
  return result
}
const dropdown = component('../../src/components/ModelSelectorDropdown.vue', pricing)
const models = [{ id: 'model-a', name: 'Model A', vendor: 'Vendor', vision: true }, { id: 'model-b', name: 'Model B', vendor: 'Vendor', vision: false }]
let requests = [], saved = 'model-a', catalog = { models, defaultModel: 'model-a' }
globalThis.uni = { getStorageSync: () => saved }
const Welcome = component('../../src/components/welcome/WelcomePane.vue', {
  ModelSelectorDropdown: dropdown, CloudAcceptDialog: stub, FolderCatalog: stub, AccountProjectCatalog: stub,
  fetchAiModels: async options => { requests.push(options); return catalog },
  getMyProjects: async () => [], getTelemetrySettings: async () => ({ enabled: false }), getRecentProjectIds: () => [],
  getCurrentUser: () => null, isDesktopHost: () => false, host: {}, siteBaseUrl: () => '', setGlobalOverlay: noop,
  ICONS: {}, buildRecentProjects: () => [], loadTelemetryNoticeDismissed: () => true, saveTelemetryNoticeDismissed: noop,
})
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick() }
test('mounted welcome picker opens, selects actual dropdown option, and emits selection with prompt', async () => {
  const root = document.createElement('div'); document.body.append(root)
  let emitted
  const app = Vue.createApp(Welcome, { onStartChat: payload => { emitted = payload } })
  app.config.globalProperties.$t = key => key
  app.config.warnHandler = noop
  const vm = app.mount(root)
  await settle()
  assert.deepEqual(requests[0], { accountPrompt: false })
  assert.match(root.querySelector('[data-quick="model"]').textContent, /Model A/)
  root.querySelector('[data-quick="model"]').dispatchEvent(new window.Event('tap'))
  await settle()
  assert.equal(requests.at(-1).accountPrompt, true)
  assert.equal(root.querySelectorAll('.model-option').length, 2)
  root.querySelectorAll('.model-option')[1].dispatchEvent(new window.Event('tap', { bubbles: true }))
  await Vue.nextTick()
  assert.equal(root.querySelector('.model-dropdown'), null)
  assert.match(root.querySelector('[data-quick="model"]').textContent, /Model B/)
  vm.quickPrompt = ' test prompt '
  root.querySelector('[data-quick="send"]').dispatchEvent(new window.Event('tap'))
  assert.equal(emitted.model.id, 'model-b')
  assert.equal(emitted.prompt, 'test prompt')
  assert.equal(vm.explicitModel, null)
  app.unmount(); root.remove()
})
test('default is not overridden; retired stored model displays server fallback', async () => {
  saved = 'retired'
  const vm = { ...Welcome.data(), $t: key => key }
  await Welcome.methods.loadModels.call(vm, false)
  assert.equal(vm.selectedModel.id, 'model-a')
  assert.equal(vm.explicitModel, null)
})
test('host applies selected model before sending, including entry without prompt', async () => {
  const source = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const body = source.match(/async handleWelcomeStartChat\(payload = \{\}\) \{([\s\S]*?)\n    \},/)[1]
  const handle = new Function(`return async function(payload = {}) {${body}}`)()
  const calls = []
  const vm = { switchViewMode: async () => true, $nextTick: async () => {}, $refs: { chatInterface: {
    selectModel: model => calls.push(['select', model.id]), sendQuickPrompt: prompt => calls.push(['send', prompt]),
  } } }
  await handle.call(vm, { prompt: 'hello', model: models[1] })
  assert.deepEqual(calls, [['select', 'model-b'], ['send', 'hello']])
  calls.length = 0
  await handle.call(vm, { model: models[1] })
  assert.deepEqual(calls, [['select', 'model-b']])
})
