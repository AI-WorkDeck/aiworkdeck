// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X-S1 part 3: the UI hygiene guard rejects toasts that show raw exception text.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rawToastCounts } from '../../../scripts/check-ui-hygiene.mjs'

test('raw e.message in a toast is counted; errorText(...) is not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toast-'))
  try {
    const bad = path.join(dir, 'Bad.vue'), good = path.join(dir, 'Good.vue')
    fs.writeFileSync(bad, "<script>\nuni.showToast({ title: e.message || this.$t('x'), icon: 'none' })\nuni.showToast({ title: this.$t('y', { msg: (err && err.message) || '' }) })\n</script>")
    fs.writeFileSync(good, "<script>\nuni.showToast({ title: errorText(e, this.$t('x')), icon: 'none' })\n// uni.showToast({ title: e.message })\n</script>")
    const counts = rawToastCounts([bad, good])
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 2)
    assert.ok(Object.keys(counts).every((k) => k.endsWith('Bad.vue')))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('the shipped frontend has no raw-exception toasts left', () => {
  assert.deepEqual(rawToastCounts(), {})
})
