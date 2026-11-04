// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<body><div id="app"></div></body>', { url: 'http://route-qa.localhost/h5/index.html' })
for (const key of ['window', 'document', 'history', 'location', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key]
const { createApp, h, computed, KeepAlive, nextTick } = await import('vue')
const { createRouter, createWebHashHistory, RouterView, useRoute } = await import('vue-router')
const uni = readFileSync(new URL('../../node_modules/@dcloudio/uni-h5/dist/uni-h5.es.js', import.meta.url), 'utf8')
// Use the installed Uni runtime's actual key expression, not a hand-written query omission.
const stateBody = uni.match(/function getStateId\(\) \{([\s\S]*?)\n\}/)[1]
const keyBody = uni.match(/function normalizeRouteKey\(path, id2\) \{([\s\S]*?)\n\}/)[1]
const keyExpression = uni.match(/const routeKey = computed\(\s*\(\) => ([^\n]+)\n\s*\)/)[1]
const getStateId = new Function(stateBody)
const normalizeRouteKey = new Function('SEP', `return (path,id2)=>{${keyBody}}`)('$$')
const keyFor = new Function('route', 'getStateId', 'normalizeRouteKey', `return ${keyExpression}`)

test('real VueRouter with Uni route key retains setup identity on same-path query, fresh page reads it', async () => {
  const loads = []
  const Page = { setup() {
    const capturedId = Number(useRoute().query.id)
    loads.push(capturedId)
    return () => h('span', String(capturedId))
  } }
  const make = () => {
    const router = createRouter({ history: createWebHashHistory(), routes: [{ path: '/workspace', component: Page, meta: { route: 'workspace' } }] })
    const app = createApp({ setup() {
      const route = useRoute()
      const key = computed(() => keyFor(route, getStateId, normalizeRouteKey))
      return () => h(RouterView, null, { default: ({ Component }) => h(KeepAlive, null, [h(Component, { key: key.value })]) })
    } })
    app.use(router)
    return { app, router }
  }
  let current = make()
  await current.router.push('/workspace?id=2')
  await current.router.isReady()
  current.app.mount('#app')
  await current.router.push('/workspace?id=1&loose=1')
  await nextTick()
  assert.equal(current.router.currentRoute.value.query.id, '1')
  assert.equal(document.querySelector('#app').textContent, '2', 'query changed but page initialization did not rerun')
  assert.deepEqual(loads, [2])
  current.app.unmount(); current.router.options.history.destroy()
  current = make()
  await current.router.isReady()
  current.app.mount('#app')
  await nextTick()
  assert.equal(document.querySelector('#app').textContent, '1', 'fresh document initialization consumes the actual deep link')
  assert.deepEqual(loads, [2, 1])
  current.app.unmount(); current.router.options.history.destroy()
})
