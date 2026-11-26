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
