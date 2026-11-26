// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C11 edge (lane C, 0.91.0 gate re-run): 交稿 pressed directly in the ~2 s before the page noticed it was
// offline failed and queued nothing; 5 min after reconnecting nothing had been submitted. A failed direct
// submit now re-checks online and, if the library is unreachable, queues like the guide does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { submitFailedOffline } from '../../src/utils/submitGuide.js'

const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')

test('submitFailedOffline asks the library once and reports only a confirmed offline', async () => {
  const calls = []
  assert.equal(await submitFailedOffline(7, async (id) => { calls.push(id); return { data: { offline: true } } }), true)
  assert.deepEqual(calls, [7])
  assert.equal(await submitFailedOffline(7, async () => ({ data: { offline: false, pendingUpload: true } })), false)
  assert.equal(await submitFailedOffline(7, async () => { throw new Error('check failed') }), false, 'unknown is not offline')
  assert.equal(await submitFailedOffline(7, async () => null), false)
})

for (const [file, method] of [['components/collab/CollabDialog.vue', 'async onUpload()'], ['components/version/CommitHistoryTab.vue', 'async onSubmitDraft()']]) {
  test(`${file}: a failed direct 交稿 that turns out to be offline is queued`, () => {
    const src = read(file)
    const body = src.slice(src.indexOf(method), src.indexOf('\n    },\n', src.indexOf(method)))
    const handler = body.slice(body.lastIndexOf('} catch (e) {'))
    assert.match(handler, /await submitFailedOffline\(this\.projectId, checkCloud\)/)
    assert.match(handler, /this\.\$emit\('queued'\)/)
    assert.match(handler, /version\.submitQueuedOffline/)
    assert.ok(handler.indexOf('showLargeFileBackupBlock') < handler.indexOf('submitFailedOffline'), 'the large-file dialog still wins')
    assert.match(src, /emits: \[[^\]]*'queued'/)
  })
}

test('the page queues for the 协作 dialog, both history panes and the guide', () => {
  const page = read('pages/project-overview/project-overview.vue')
  assert.equal(page.match(/@queued="onSubmitQueuedOffline"/g).length, 4)
})
