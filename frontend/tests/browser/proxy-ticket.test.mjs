// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Web/H5 浏览器面板的 iframe 走 /api/browser/proxy，后端要求带一张已登录换来的代理票据
// （BrowserProxyController#ticket）。这里把 BrowserPane 的 <script> 剥出来真跑，钉住：
//   ① iframe 地址带上票据，且绝不带会话 id；
//   ② 票据没过期就复用，不每次导航都换；
//   ③ 换票期间又发起了新导航，慢回来的旧导航不能盖掉新地址。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function loadComponent(file, names, deps) {
  const src = readFileSync(new URL(`../../src/components/${file}`, import.meta.url), 'utf8')
  const script = src.slice(src.indexOf('<script>') + 8, src.indexOf('</script>'))
    .replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '')
  // eslint-disable-next-line no-new-func
  return new Function(...names, script.replace('export default', 'return'))(...names.map((n) => deps[n]))
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function makePane(mint) {
  const names = ['getApiBaseUrl', 'createProjectFavorite', 'getProjectFavorites', 'getMyFavorites',
    'createBrowserProxyTicket', 'ICONS', 'host', 'shouldShowLoadError', 'loadErrorMessageKey', 'uni']
  const deps = {
    getApiBaseUrl: () => 'http://api.test',
    createProjectFavorite: async () => ({}),
    getProjectFavorites: async () => [],
    getMyFavorites: async () => [],
    createBrowserProxyTicket: mint,
    ICONS: {},
    host: { app: {} },
    shouldShowLoadError: () => false,
    loadErrorMessageKey: () => '',
    uni: { getStorageSync: () => '', setStorageSync: () => {}, $on: () => {}, $off: () => {} },
  }
  const component = loadComponent('BrowserPane.vue', names, deps)
  const base = { $t: (k) => k, $emit: () => {}, $nextTick: (fn) => fn && fn(), projectId: 7, url: '', tabId: 't1' }
  const vm = Object.assign(base, component.data.call(base), component.methods)
  for (const [k, def] of Object.entries(component.computed || {})) {
    const fn = typeof def === 'function' ? def : def.get
    Object.defineProperty(vm, k, { get: () => fn.call(vm), configurable: true })
  }
  Object.defineProperty(vm, 'isDesktopBrowser', { get: () => false, configurable: true })
  return vm
}

test('iframe 地址带上代理票据，票据未过期时复用', async () => {
  let calls = 0
  const vm = makePane(async () => {
    calls++
    return { code: 0, data: { ticket: `tk${calls}`, expiresAt: Date.now() + 10 * 60 * 1000 } }
  })
  vm.navigate('https://example.com/a')
  await flush()
  const src = new URL(vm.iframeSrc)
  assert.equal(src.pathname, '/api/browser/proxy')
  assert.equal(src.searchParams.get('url'), 'https://example.com/a')
  assert.equal(src.searchParams.get('ticket'), 'tk1')
  assert.ok(!/session/i.test(vm.iframeSrc), '会话 id 绝不能进 URL')

  vm.navigate('https://example.com/b')
  await flush()
  assert.equal(calls, 1, '票据还新鲜，不该再换')
  assert.equal(new URL(vm.iframeSrc).searchParams.get('ticket'), 'tk1')
})

test('票据快过期时重新换一张', async () => {
  let calls = 0
  const vm = makePane(async () => {
    calls++
    return { code: 0, data: { ticket: `tk${calls}`, expiresAt: Date.now() + (calls === 1 ? 30 * 1000 : 600 * 1000) } }
  })
  vm.navigate('https://example.com/a')
  await flush()
  vm.navigate('https://example.com/b')
  await flush()
  assert.equal(calls, 2)
  assert.equal(new URL(vm.iframeSrc).searchParams.get('ticket'), 'tk2')
})

test('换票期间的新导航不会被慢回来的旧导航盖掉', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  const vm = makePane(async () => {
    await gate
    return { code: 0, data: { ticket: 'tk', expiresAt: Date.now() + 600 * 1000 } }
  })
  vm.navigate('https://example.com/old')
  vm.navigate('https://example.com/new')
  release()
  await flush()
  await flush()
  assert.equal(new URL(vm.iframeSrc).searchParams.get('url'), 'https://example.com/new')
})
