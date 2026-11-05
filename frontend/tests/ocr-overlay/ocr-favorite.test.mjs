// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 教程问题 71/69/73（dev-board#1713）：
// - 截图「加入收藏」的标题用页面标题，没有就用主机名 + 时间（不再是整条 URL），meta 带 sourceHost；
// - 收藏失败提示走 host.app.confirm（toast 会被原生 BrowserView 盖住）；
// - ocrDebug 默认关闭。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ACTIONS = readFileSync(new URL('../../src/pages/project-overview/ocrActions.js', import.meta.url), 'utf8')
const PAGE = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')

function extract(name) {
  const start = ACTIONS.indexOf(`async ${name}() {`)
  assert.ok(start > 0, `找不到 ${name}`)
  const open = ACTIONS.indexOf('{', start)
  let depth = 0
  let i = open
  for (; i < ACTIONS.length; i++) {
    if (ACTIONS[i] === '{') depth++
    else if (ACTIONS[i] === '}' && --depth === 0) break
  }
  // eslint-disable-next-line no-new-func
  return new Function('createProjectFavorite', 'uni', 'host', `return async function () {${ACTIONS.slice(open + 1, i)}}`)
}

function run({ title = '', url = 'https://www.example.com/a/b?c=1', fail = null } = {}) {
  const created = []
  const confirms = []
  const toasts = []
  const fn = extract('ocrDoFavorite')(
    async (_pid, payload) => { if (fail) throw new Error(fail); created.push(payload); return { id: 5 } },
    { showToast: (o) => toasts.push(o) },
    { app: { confirm: async (o) => { confirms.push(o); return {} } } },
  )
  const vm = {
    projectId: 3, ocrImageDataUrl: 'data:image/png;base64,AAAA', ocrSourceUrl: url, ocrSourceTitle: title,
    closeOcrOverlay() {}, focusFavoritePlugin() {}, $t: (k) => k,
  }
  return { done: fn.call(vm), created, confirms, toasts }
}

test('71: 有页面标题就用页面标题，meta 带 sourceHost', async () => {
  const r = run({ title: '中国裁判文书网' })
  await r.done
  assert.equal(r.created[0].title, '中国裁判文书网')
  assert.equal(r.created[0].sourceUrl, 'https://www.example.com/a/b?c=1')
  assert.equal(JSON.parse(r.created[0].meta).sourceHost, 'www.example.com')
})

test('71: 没有页面标题用「主机名 + 时间」，不再是整条 URL', async () => {
  const r = run({ title: '' })
  await r.done
  assert.match(r.created[0].title, /^www\.example\.com \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})

test('69: 收藏失败走 host.app.confirm，不只弹会被 BrowserView 盖住的 toast', async () => {
  const r = run({ fail: 'boom' })
  await r.done
  assert.equal(r.confirms.length, 1)
  assert.equal(r.confirms[0].title, 'workbenchOps.favoriteFailed')
})

test('73: ocrDebug 默认关闭', () => {
  assert.match(PAGE, /ocrDebug:\s*false,/)
})
