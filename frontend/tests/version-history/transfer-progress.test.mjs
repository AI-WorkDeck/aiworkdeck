// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// CEO 2026-11-26 (after #1764): a slow large-file 交稿/取回 must visibly progress, not look like a hang.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatTransfer, withTransferProgress } from '../../src/utils/transferProgress.js'

const t = (key, p) => `${key}:${p.done}/${p.total}`
const MB = 1024 * 1024

test('formatTransfer shows MB for uploads and downloads, nothing when idle', () => {
  assert.equal(formatTransfer({ active: true, direction: 'upload', doneBytes: 12.34 * MB, totalBytes: 30 * MB }, t), 'version.transferUploading:12.3/30.0')
  assert.equal(formatTransfer({ active: true, direction: 'download', doneBytes: 0, totalBytes: 60 * MB }, t), 'version.transferDownloading:0.0/60.0')
  assert.equal(formatTransfer({ active: true, direction: 'upload', doneBytes: 40 * MB, totalBytes: 30 * MB }, t), 'version.transferUploading:30.0/30.0', 'never over 100%')
  assert.equal(formatTransfer({ active: false }, t), '')
  assert.equal(formatTransfer({ active: true, totalBytes: 0 }, t), '')
  assert.equal(formatTransfer(null, t), '')
})

test('a quick submit shows nothing; a slow one shows growing progress and hides it at the end', async () => {
  const shown = []; let hidden = 0
  const ui = { t, show: (x) => shown.push(x), hide: () => hidden++, interval: 5, delay: 5 }
  await withTransferProgress(7, async () => 'quick', { ...ui, read: async () => ({ data: { active: true, direction: 'upload', doneBytes: MB, totalBytes: 2 * MB } }) , delay: 1000 })
  assert.deepEqual(shown, []); assert.equal(hidden, 0, 'no loading flashes for a fast request')

  let done = 0
  const read = async () => ({ data: { active: true, direction: 'upload', doneBytes: (done += 10 * MB), totalBytes: 30 * MB } })
  const result = await withTransferProgress(7, () => new Promise((r) => setTimeout(() => r('ok'), 40)), { ...ui, read })
  assert.equal(result, 'ok')
  assert.ok(shown.length >= 2, `progress updated while the request was in flight: ${shown}`)
  assert.equal(shown[0], 'version.transferUploading:10.0/30.0')
  assert.equal(hidden, 1)
  const after = shown.length
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(shown.length, after, 'polling stops with the request')
})

test('a failed submit still hides the progress and rethrows; a failing progress read is ignored', async () => {
  let hidden = 0
  const read = async () => ({ data: { active: true, direction: 'upload', doneBytes: MB, totalBytes: 2 * MB } })
  await assert.rejects(withTransferProgress(7, () => new Promise((_, no) => setTimeout(() => no(new Error('offline')), 30)),
    { t, read, show() {}, hide: () => hidden++, interval: 5, delay: 5 }), /offline/)
  assert.equal(hidden, 1)
  const value = await withTransferProgress(7, () => new Promise((r) => setTimeout(() => r(1), 20)),
    { t, read: async () => { throw new Error('busy') }, show() { throw new Error('must not show') }, hide() {}, interval: 5, delay: 5 })
  assert.equal(value, 1)
})

test('submit and pull both go through the progress wrapper', () => {
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  for (const fn of ['uploadToCloud', 'updateFromCloud']) {
    const body = api.slice(api.indexOf(`export function ${fn}(`), api.indexOf('\n}\n', api.indexOf(`export function ${fn}(`)))
    assert.match(body, /withTransferProgress\(projectId,/, fn)
  }
  assert.match(api, /url: `\/api\/cloud\/projects\/\$\{projectId\}\/transfer`, method: 'GET'/)
})

// C32（CEO 2026-11-27）：交稿/取回/取到本机等大请求放宽到 30 分钟，但后端真死了（冻住、崩了）
// 不能让律师干等 30 分钟——进度探针连续几次网络层失败就提前收手，报「本机服务没响应」。
test('a dead local service ends a long transfer early with a network error, and aborts the request', async () => {
  let aborted = false
  const run = (signal) => new Promise((_, no) => {
    signal.addEventListener('abort', () => { aborted = true; no(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
  })
  const read = async () => { throw Object.assign(new Error('request:fail'), { errMsg: 'request:fail timeout' }) }
  const started = Date.now()
  await assert.rejects(withTransferProgress(7, run, { t, read, show() {}, hide() {}, interval: 5, delay: 5, deadAfter: 3 }),
    (e) => /request:fail/.test(e.message) && e.name !== 'AbortError')
  assert.ok(aborted, 'the in-flight request is aborted')
  assert.ok(Date.now() - started < 1000, 'it gives up after a few probes, not at the request timeout')
})

test('one network blip does not end a transfer; a busy (non-network) answer never does', async () => {
  let n = 0
  const blip = async () => { n++; if (n === 2) throw new Error('request:fail'); return { data: { active: false } } }
  assert.equal(await withTransferProgress(7, () => new Promise((r) => setTimeout(() => r('ok'), 60)),
    { t, read: blip, show() {}, hide() {}, interval: 5, delay: 5, deadAfter: 3 }), 'ok')
  assert.equal(await withTransferProgress(7, () => new Promise((r) => setTimeout(() => r('ok'), 60)),
    { t, read: async () => { throw new Error('正在整理版本，请稍后重试') }, show() {}, hide() {}, interval: 5, delay: 5, deadAfter: 3 }), 'ok')
})

test('交稿, 取回 and 取到本机 wait 30 minutes and pass the abort signal; the probe itself times out fast', () => {
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  for (const [fn, url] of [['uploadToCloud', '/upload`'], ['updateFromCloud', '/update`'], ['acceptCloudProject', "'/api/cloud/accept'"]]) {
    const body = api.slice(api.indexOf(`export function ${fn}(`), api.indexOf('\n}\n', api.indexOf(`export function ${fn}(`)))
    assert.match(body, /withTransferProgress\(/, `${fn} runs under the liveness probe`)
    assert.match(body, /\(signal\) =>/, `${fn} receives the abort signal`)
    assert.ok(body.includes(url), fn)
    assert.match(body, /timeout: 1800000, signal/, `${fn} waits 30 min and is abortable`)
  }
  assert.match(api, /url: `\/api\/cloud\/projects\/\$\{projectId\}\/transfer`, method: 'GET', timeout: 4000/)
})

// C32 复测（lane C 11-28）：冻住后端后看门狗到 +97 s 才收手。探针若自己挂住不返回，
// 旧实现「等这一次探针结束再排下一次」会跟着一起停——存活判断不能取决于某一次探针能否返回。
test('a probe that hangs (never resolves) still ends the transfer early', async () => {
  let aborted = false
  const run = (signal) => new Promise((_, no) => {
    signal.addEventListener('abort', () => { aborted = true; no(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
  })
  let reads = 0
  const read = () => { reads++; return new Promise(() => {}) } // a frozen service: no answer, no error
  const started = Date.now()
  await assert.rejects(withTransferProgress(7, run, { t, read, show() {}, hide() {}, interval: 5, delay: 5, deadAfter: 3, staleAfter: 60 }),
    (e) => /request:fail/.test(e.message) && e.name !== 'AbortError')
  assert.ok(aborted, 'the in-flight request is aborted')
  assert.ok(Date.now() - started < 1000, `ends after staleAfter, not when the probe finally returns (${Date.now() - started} ms)`)
  assert.equal(reads, 1, 'hung probes do not pile up')
})

test('a slow but answering service is not declared dead', async () => {
  const read = () => new Promise((r) => setTimeout(() => r({ data: { active: false } }), 15))
  assert.equal(await withTransferProgress(7, () => new Promise((r) => setTimeout(() => r('ok'), 150)),
    { t, read, show() {}, hide() {}, interval: 5, delay: 5, deadAfter: 3, staleAfter: 60 }), 'ok')
})

test('C12 nit: the foreground transfer announces its end, also when it fails', async () => {
  const ends = []
  const ui = { t, read: async () => ({ data: { active: false } }), show() {}, hide() {}, end: (id) => ends.push(id), interval: 5, delay: 5 }
  await withTransferProgress(7, async () => 'ok', ui)
  await assert.rejects(withTransferProgress(8, async () => { throw new Error('refused') }, ui), /refused/)
  assert.deepEqual(ends, [7, 8])
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  assert.match(api, /uni\.\$emit\('awd:cloud-transfer-foreground', \{ projectId, on: true \}\)/)
  assert.match(api, /end: \(projectId\) => \{ try \{ uni\.\$emit\('awd:cloud-transfer-foreground', \{ projectId, on: false \}\)/)
})
