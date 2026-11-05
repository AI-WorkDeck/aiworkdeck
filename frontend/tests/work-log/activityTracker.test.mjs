// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 工作记录的空闲扣减与录制状态持久化（dev-board#1713，问题 51/52/54）。
// activityTracker.js 依赖 @/ 别名，这里读源码把 api 导入换成替身后按 data: URL 导入。
// 跑法：npm run test:work-log

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const SRC = fs.readFileSync(new URL('../../src/utils/activityTracker.js', import.meta.url), 'utf8')
  .replace(/import \{ logActivity \} from '@\/services\/api\.js'/, 'const logActivity = () => {}')
  .replace(/import \{ host \} from '@\/services\/host\.js'/, 'const host = {}')

const MIN = 60 * 1000
let now = 1_700_000_000_000
const realNow = Date.now
Date.now = () => now

const store = new Map()
globalThis.uni = {
  getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k, v) => { store.set(k, v) },
}

const mod = await import('data:text/javascript;base64,' + Buffer.from(SRC).toString('base64'))
const { ActivityTracker } = mod

let calls
function makeTracker(opts = {}) {
  calls = []
  return new ActivityTracker({ log: (...a) => { calls.push(a) }, ...opts })
}
const flushMicrotasks = () => new Promise((r) => setImmediate(r))

beforeEach(() => { store.clear(); now = 1_700_000_000_000 })

test('连续 5 分钟以上无动作的空闲段从会话时长里扣掉，并写进 IdleSegments', async () => {
  const t = makeTracker()
  t.setRecording(true)
  const t0 = now
  t.trackActivePage('OPEN_FILE', 7, '合同.docx', 3, 'Project: 并购')
  now = t0 + 1 * MIN; t.noteActivity()
  now = t0 + 11 * MIN; t.noteActivity() // 中间 10 分钟无动作
  now = t0 + 12 * MIN
  t.flushActiveSession()
  await flushMicrotasks()
  assert.equal(calls.length, 1)
  const [action, id, name, duration, meta, projectId] = calls[0]
  assert.deepEqual([action, id, name, projectId], ['OPEN_FILE', 7, '合同.docx', 3])
  assert.equal(duration, 2 * MIN)
  assert.equal(meta, `Project: 并购. IdleSegments: ${t0 + MIN}-${t0 + 11 * MIN}`)
  t.setRecording(false)
})

test('不足 5 分钟的停顿不算空闲', async () => {
  const t = makeTracker()
  t.setRecording(true)
  const t0 = now
  t.trackActivePage('OPEN_URL', 0, 'https://a.example', 3, '')
  now = t0 + 4 * MIN; t.noteActivity()
  now = t0 + 6 * MIN
  t.flushActiveSession()
  await flushMicrotasks()
  assert.equal(calls[0][3], 6 * MIN)
  assert.equal(calls[0][4], '')
  t.setRecording(false)
})

test('结束时仍处于空闲：从最后一次动作起的尾巴扣掉', async () => {
  const t = makeTracker()
  t.setRecording(true)
  const t0 = now
  t.trackActivePage('OPEN_FILE', 1, 'a.docx', 3, '')
  now = t0 + 2 * MIN; t.noteActivity()
  now = t0 + 30 * MIN
  t.flushActiveSession()
  await flushMicrotasks()
  assert.equal(calls[0][3], 2 * MIN)
  assert.match(calls[0][4], new RegExp(`IdleSegments: ${t0 + 2 * MIN}-${t0 + 30 * MIN}$`))
  t.setRecording(false)
})

test('桌面端：主窗口在前台时按系统空闲秒数推进最后动作；不在前台不推进', async () => {
  let presence = { focused: true, idleSeconds: 0 }
  const t = makeTracker({ presence: async () => presence })
  t.setRecording(true)
  const t0 = now
  t.trackActivePage('OPEN_FILE', 1, 'a.docx', 3, '')
  // 在编辑器 webview 里一直打字：宿主 DOM 收不到事件，但每 30 秒问一次系统空闲都只有 10 秒
  presence = { focused: true, idleSeconds: 10 }
  for (let k = 1; k <= 40; k++) { now = t0 + k * 30 * 1000; await t.pollPresence() }
  // 切到别的软件 20 分钟：主窗口不在前台，不推进
  now = t0 + 40 * MIN; presence = { focused: false, idleSeconds: 0 }
  await t.pollPresence()
  t.flushActiveSession()
  t.setRecording(false)
  await flushMicrotasks()
  assert.equal(calls[0][3], 20 * MIN - 10 * 1000)
})

test('录制开关持久化，新实例启动时恢复', () => {
  const a = makeTracker()
  a.setRecording(true)
  const b = makeTracker()
  assert.equal(b.getRecordingState(), true)
  b.setRecording(false)
  assert.equal(makeTracker().getRecordingState(), false)
  a.setRecording(false)
})

test('页面挂起只结束当前会话，不改录制开关；恢复后继续记录', async () => {
  const t = makeTracker()
  t.setRecording(true)
  t.trackActivePage('OPEN_FILE', 1, 'a.docx', 3, '')
  now += MIN
  t.stop()
  await flushMicrotasks()
  assert.equal(calls.length, 1)
  assert.equal(t.getRecordingState(), true)
  t.trackActivePage('OPEN_FILE', 2, 'b.docx', 3, '')
  assert.equal(t.activeSession, null)
  t.start()
  t.trackActivePage('OPEN_FILE', 2, 'b.docx', 3, '')
  assert.equal(t.activeSession.targetName, 'b.docx')
  t.setRecording(false)
})

process.on('exit', () => { Date.now = realNow })

test('窗口不在前台时，鼠标从窗口上划过不算动作（真机复测发现：后台窗口照样收到 mousemove，空闲段被冲掉）', async () => {
  const t = makeTracker()
  t.setRecording(true)
  t.trackActivePage('OPEN_FILE', 1, 'a.docx', 9, 'Project: X')
  const prevDoc = globalThis.document
  globalThis.document = { hasFocus: () => false, visibilityState: 'visible' }
  try {
    now += 3 * MIN; t._onDomActivity({ type: 'mousemove' })
    now += 4 * MIN
    globalThis.document = { hasFocus: () => true, visibilityState: 'visible' }
    t._onDomActivity({ type: 'mousedown' })
    now += 1 * MIN
    t.flushActiveSession(); await flushMicrotasks()
  } finally { globalThis.document = prevDoc }
  assert.equal(calls.length, 1)
  assert.match(calls[0][4], /IdleSegments: /)
  assert.equal(calls[0][3], MIN, `后台 7 分钟应整段扣掉，只剩回到前台后的 1 分钟，实际 ${calls[0][3]}ms`)
})
