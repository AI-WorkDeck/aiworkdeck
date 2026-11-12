// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('desktop preference controls whether the project scan is mounted', async () => {
  const source = readFileSync(new URL('../../src/utils/projectExitDialog.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export function', 'function')
  for (const state of [
    { autoScan: true, receipts: [], expectedMounts: 1 },
    { autoScan: false, receipts: [], expectedMounts: 0 },
    { autoScan: false, receipts: [{ id: 1 }], expectedMounts: 1 },
  ]) {
    let mounts = 0, finish
    const document = { createElement: () => ({ remove() {} }), body: { appendChild() {} }, activeElement: null }
    const createApp = (_component, props) => {
      finish = props.onClose
      return { config: { globalProperties: {} }, mount() { mounts++ }, unmount() {} }
    }
    const confirm = new Function('createApp', 'ProjectExitDialog', 't', 'pendingExitProjects', 'getSessionId',
      'isDesktopHost', 'setGlobalOverlay', 'shouldScanProjectsOnExit', 'document', source + '; return confirmProjectExit')(
        createApp, {}, key => key, () => state.receipts, () => 'session', () => true, () => {},
        () => state.autoScan, document)
    const result = confirm()
    assert.equal(mounts, state.expectedMounts)
    if (mounts) finish(false)
    assert.equal(await result, !state.expectedMounts)
  }
})

test('personal settings expose the same desktop preference', () => {
  const panel = readFileSync(new URL('../../src/components/userprofile/PersonalSettingsPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /shouldScanProjectsOnExit/)
  assert.match(panel, /setScanProjectsOnExit/)
  assert.match(panel, /account\.exitAutoScanLabel/)
})

test('desktop user can turn off project scanning from the rendered personal settings', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<body></body>')
  for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key]
  const Vue = await import('vue')
  const { parse } = await import('@vue/compiler-sfc')
  const { compile } = await import('@vue/compiler-dom')
  const { descriptor } = parse(readFileSync(new URL('../../src/components/userprofile/PersonalSettingsPanel.vue', import.meta.url), 'utf8'))
  const script = descriptor.script.content
  const names = []
  for (const match of script.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'[^']+'\s*;?/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).at(-1)
      if (name) names.push(name)
    }
  }
  for (const match of script.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*'[^']+'\s*;?/g)) names.push(match[1])
  const values = new Map()
  const preferences = await import('../../src/utils/projectExitPreferences.js')
  const uni = {
    getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, value),
    showToast() {}, $on() {}, $off() {},
  }
  const components = {
    AwdSwitch: {
      props: ['checked', 'ariaLabel'],
      template: '<button role="switch" :aria-label="ariaLabel" @click="$emit(\'change\', !checked)"></button>',
    },
    SettingsSection: { template: '<section><slot /></section>' },
    SettingsRow: { template: '<div><slot /></div>' },
    LanguagePicker: { template: '<div />' },
  }
  const deps = new Proxy({
    ...components,
    shouldScanProjectsOnExit: storage => preferences.shouldScanProjectsOnExit(storage || uni),
    setScanProjectsOnExit: (enabled, storage) => preferences.setScanProjectsOnExit(enabled, storage || uni),
    isDesktopHost: () => true,
    getCurrentUser: () => null,
    getCurrentUserApi: async () => ({ code: 1 }),
    loadIdentityProfile: async () => ({ source: 'LOCAL', profile: {} }),
    PROFILE_SOURCE: { LOCAL: 'LOCAL', ACCOUNT: 'ACCOUNT' },
    REDLINE_AUTHOR_KEY: 'author', MAX_REDLINE_AUTHOR_CHARS: 48, LOCALE_REGISTRY: [],
  }, { get: (target, key) => target[key] || (async () => {}) })
  const preamble = names.map(name => `const ${name} = deps[${JSON.stringify(name)}]`).join('\n')
  const body = script.replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']+'\s*;?/g, '')
    .replace(/import\s+[A-Za-z_$][\w$]*\s+from\s*'[^']+'\s*;?/g, '')
    .replace('export default', 'return')
  const component = new Function('deps', 'uni', preamble + '\n' + body)(deps, uni)
  component.render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)(Vue)
  const app = Vue.createApp(component)
  app.config.globalProperties.$t = key => key
  app.config.warnHandler = () => {}
  const root = document.createElement('div'); document.body.append(root)
  const vm = app.mount(root)
  await Vue.nextTick()
  const toggle = root.querySelector('[role="switch"][aria-label="account.exitAutoScanLabel"]')
  assert.ok(toggle)
  assert.equal(vm.exitAutoScan, true)
  toggle.click()
  await Vue.nextTick()
  assert.equal(vm.exitAutoScan, false)
  assert.equal(preferences.shouldScanProjectsOnExit(uni), false)
  app.unmount(); root.remove(); dom.window.close()
})

test('closing during a slow retry cannot start a hidden submission', async () => {
  const { parse } = await import('@vue/compiler-sfc')
  const { descriptor } = parse(readFileSync(new URL('../../src/components/version/ProjectExitDialog.vue', import.meta.url), 'utf8'))
  const script = descriptor.script.content.replace(/import[^\n]+\n/g, '').replace('export default', 'return')
  const state = await import('../../src/utils/projectExitState.js')
  let releaseRead
  const component = new Function('getMyProjects', 'getVersionExitProjects', 'getVersionExitStatus', 'endWorkSession',
    'inspectExitProject', 'commitExitProjects', 'pendingExitProjects', 'settleExitCommit', 'selectExitProjectRows', script)(
      async () => {}, async () => {}, async () => {}, async () => {}, state.inspectExitProject,
      state.commitExitProjects, state.pendingExitProjects, state.settleExitCommit, state.selectExitProjectRows)
  let submissions = 0
  const vm = {
    busy: false, loading: false, _disposed: false, isCurrent: () => true,
    readStatus: () => new Promise(resolve => { releaseRead = resolve }),
    submit: async () => { submissions++ },
  }
  const attempt = component.methods.retryCommit.call(vm, { state: 'failed', errorKind: 'commit' })
  vm._disposed = true
  releaseRead({ receiptEpoch: 'epoch', enabled: true, working: true, changedCount: 1, canCommit: true })
  await attempt
  assert.equal(submissions, 0)
})
