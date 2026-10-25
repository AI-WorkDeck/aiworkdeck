// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// v2.6 主题通道行为测试：SDK 收到 init/theme 消息后必须自动挂 data-theme、
// body class 并把令牌写成 CSS 变量；onChange 回调收到推送；未知 type 静默忽略
// （老 SDK 对新宿主 / 新 SDK 对老宿主的双向兼容判据）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const src = readFileSync(resolve(root, 'sdk/plugin-sdk/awd-plugin-sdk.js'), 'utf8')

function makeEnv() {
  const listeners = []
  const rootEl = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v },
    style: { props: {}, setProperty(k, v) { this.props[k] = v } }
  }
  const body = {
    classes: new Set(),
    classList: {
      toggle(c, on) { if (on) body.classes.add(c); else body.classes.delete(c) }
    }
  }
  const win = {
    parent: { posted: [], postMessage(m) { this.posted.push(m) } },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn) }
  }
  const doc = { documentElement: rootEl, body }
  new Function('window', 'document', src)(win, doc)
  const dispatch = (data, source) => listeners.forEach((fn) => fn({ source: source || win.parent, data }))
  return { win, rootEl, body, dispatch, awd: win.awd }
}

test('init 带 themeTokens：自动挂 data-theme + body class + CSS 变量', async () => {
  const env = makeEnv()
  env.dispatch({
    awd: 1, type: 'init',
    context: { pluginId: 'p', theme: 'dark', themeTokens: { '--awd-surface': '#1C2024', '--awd-text': '#E7EAEC' } }
  })
  const ctx = await env.awd.ready()
  assert.equal(ctx.theme, 'dark')
  assert.equal(env.rootEl.attrs['data-theme'], 'dark')
  assert.equal(env.rootEl.style.props['--awd-surface'], '#1C2024')
  assert.ok(env.body.classes.has('awd-theme-dark'))
  assert.ok(!env.body.classes.has('awd-theme-light'))
  assert.deepEqual(env.awd.theme.get(), { mode: 'dark', tokens: { '--awd-surface': '#1C2024', '--awd-text': '#E7EAEC' } })
})

test('theme 推送：切换生效且 onChange 回调收到，退订后不再收', () => {
  const env = makeEnv()
  env.dispatch({ awd: 1, type: 'init', context: { theme: 'light', themeTokens: { '--awd-surface': '#FFFFFF' } } })
  const seen = []
  const off = env.awd.theme.onChange((mode, tokens) => seen.push([mode, tokens['--awd-surface']]))
  env.dispatch({ awd: 1, type: 'theme', theme: 'dark', tokens: { '--awd-surface': '#1C2024' } })
  assert.deepEqual(seen, [['dark', '#1C2024']])
  assert.equal(env.rootEl.attrs['data-theme'], 'dark')
  assert.ok(env.body.classes.has('awd-theme-dark'))
  off()
  env.dispatch({ awd: 1, type: 'theme', theme: 'light', tokens: { '--awd-surface': '#FFFFFF' } })
  assert.equal(seen.length, 1)
  assert.equal(env.rootEl.attrs['data-theme'], 'light')
})

test('老宿主：init 只有 theme 字符串没有 tokens，降级为只挂 data-theme/class', async () => {
  const env = makeEnv()
  env.dispatch({ awd: 1, type: 'init', context: { pluginId: 'p', theme: 'dark' } })
  await env.awd.ready()
  assert.equal(env.rootEl.attrs['data-theme'], 'dark')
  assert.deepEqual(env.rootEl.style.props, {})
  assert.ok(env.body.classes.has('awd-theme-dark'))
})

test('未知 type 静默忽略，非本协议消息不处理', () => {
  const env = makeEnv()
  env.dispatch({ awd: 1, type: 'init', context: { theme: 'light' } })
  assert.doesNotThrow(() => {
    env.dispatch({ awd: 1, type: 'future-unknown', anything: 1 })
    env.dispatch({ awd: 99, type: 'theme', theme: 'dark' })
    env.dispatch({ awd: 1, type: 'theme', theme: 'dark' }, { not: 'parent' })
  })
  // 协议号不对 / 来源不对的 theme 消息都不得生效
  assert.equal(env.rootEl.attrs['data-theme'], 'light')
})

test('Plugin UI v3.0：有 document.head 时自动注入 awd-plugin-ui-v3 样式，且 awd.ui.progress 可渲染与清除', () => {
  const appendedStyles = []
  const makeNode = (tag) => ({
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    hidden: false,
    attrs: {},
    style: {},
    children: [],
    get firstChild() { return this.children[0] || null },
    setAttribute(k, v) { this.attrs[k] = v },
    appendChild(child) { this.children.push(child); return child },
    insertBefore(child) { this.children.unshift(child); return child },
    removeChild(child) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) this.children.splice(idx, 1)
    }
  })
  const head = makeNode('head')
  const progressHost = makeNode('div')
  const doc = {
    documentElement: { setAttribute() {}, style: { setProperty() {} } },
    body: { classList: { toggle() {} } },
    head: {
      get firstChild() { return head.firstChild },
      appendChild(el) { appendedStyles.push(el); return head.appendChild(el) },
      insertBefore(el) { appendedStyles.push(el); return head.insertBefore(el) }
    },
    getElementById(id) { return appendedStyles.find((el) => el.id === id) || null },
    querySelector(sel) { return sel === '#progress' ? progressHost : null },
    createElement: makeNode
  }
  const win = { parent: { postMessage() {} }, addEventListener() {} }
  new Function('window', 'document', src)(win, doc)

  assert.equal(appendedStyles.length, 1)
  assert.equal(appendedStyles[0].id, 'awd-plugin-ui-v3')
  assert.match(appendedStyles[0].textContent, /\.awd-plugin-stage\{container-type:inline-size/)

  let cancelled = false
  const ctrl = win.awd.ui.progress('#progress', {
    title: '正在解析底稿（14/28）',
    percent: 50,
    safetyNote: '本地文件安全',
    onCancel() { cancelled = true }
  })
  assert.equal(progressHost.hidden, false)
  assert.equal(progressHost.children.length, 1)
  assert.equal(progressHost.children[0].className, 'awd-safe-progress')
  const foot = progressHost.children[0].children[2]
  foot.children[1].onclick()
  assert.equal(cancelled, true)

  ctrl.clear()
  assert.equal(progressHost.hidden, true)
  assert.equal(progressHost.children.length, 0)
})
