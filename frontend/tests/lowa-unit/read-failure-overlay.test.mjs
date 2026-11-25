// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D2: a document whose bytes could not be read must never leave the blank boot canvas
// exposed and editable (typing there was silently discarded by the save gate). The
// failure covers the canvas, says why, offers Retry, and re-reads once the local
// service recovers.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { isReadFailure, shouldRetryReadOnRecovery, STATUS_DOWNLOAD_FAILED, STATUS_LOAD_FAILED, STATUS_FILE_MISSING, STATUS_OPEN_FAILED } from '../../src/utils/editorLoadFailure.js'

const source = fs.readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
// Pull one method/computed body out of the component so the test runs the real code.
function member(name) {
  const start = source.indexOf(`    ${name}(`)
  assert.ok(start > 0, `${name} not found`)
  const open = source.indexOf('{', start)
  let depth = 0, i = open
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break }
  return source.slice(start, i + 1)
}
function component(state) {
  const ctx = { isReadFailure, shouldRetryReadOnRecovery, STATUS_OPEN_FAILED, observeLocalContentBackend() {} }
  const obj = vm.runInNewContext(`({ ${member('readFailed')}, ${member('readRetryable')}, ${member('loadingOverlayVisible')}, ${member('onBackendHealth')} })`, ctx)
  const self = { ready: true, chromeInitialized: true, isError: true, backendHealthState: null, backendHealthRecoverySeq: 0,
    _backendHealthDisposed: false, logs: [], retries: 0, appendLog(m) { this.logs.push(m) }, retryLoad() { this.retries++ },
    backendSaveRetryReady: () => false, autoRetrySave() {}, ...state }
  for (const k of ['readFailed', 'readRetryable', 'loadingOverlayVisible']) Object.defineProperty(self, k, { get: () => obj[k].call(self) })
  self.onBackendHealth = (s) => obj.onBackendHealth.call(self, s)
  return self
}

test('read failures are recognised only while the save gate is closed', () => {
  for (const key of [STATUS_DOWNLOAD_FAILED, STATUS_LOAD_FAILED, STATUS_FILE_MISSING]) {
    assert.equal(isReadFailure(true, key), true, key)
    assert.equal(isReadFailure(false, key), false, key)
  }
  assert.equal(isReadFailure(true, 'saveFailed'), false, 'a save failure keeps the real document visible')
  assert.equal(isReadFailure(true, STATUS_OPEN_FAILED), false, 'open-failed has its own card')
  assert.equal(shouldRetryReadOnRecovery(true, STATUS_DOWNLOAD_FAILED), true)
  assert.equal(shouldRetryReadOnRecovery(true, STATUS_FILE_MISSING), false, 'a missing file is not retried')
})

test('the blank boot canvas is covered (not typeable) after a failed read', () => {
  const ed = component({ docLoadFailed: true, statusKey: STATUS_DOWNLOAD_FAILED })
  assert.equal(ed.loadingOverlayVisible, true)
  const ok = component({ docLoadFailed: false, statusKey: 'ready' })
  assert.equal(ok.loadingOverlayVisible, false, 'a loaded document stays editable')
})

test('the card explains the cause and offers Retry; the template keeps the pill out of the way', () => {
  const card = source.slice(source.indexOf('v-if="readFailed && !openFailed"'), source.indexOf('v-if="(!previewReady || chromeInitFailed) && !openFailed && !readFailed"'))
  assert.match(card, /role="alert"/)
  assert.match(card, /\$t\('editor\.status\.' \+ statusKey\)/)
  assert.match(card, /@click="retryLoad"/)
  assert.match(source, /v-if="displayStatus && !loadingOverlayVisible"/, 'no second, clipped red pill over the ruler')
})

test('the document is re-read automatically when the local service recovers', () => {
  const ed = component({ docLoadFailed: true, statusKey: STATUS_DOWNLOAD_FAILED })
  ed.onBackendHealth({ state: 'degraded', ok: false, updatedAt: 1 })
  assert.equal(ed.retries, 0)
  ed.onBackendHealth({ state: 'healthy', ok: true, updatedAt: 2 })
  assert.equal(ed.retries, 1)
  const missing = component({ docLoadFailed: true, statusKey: STATUS_FILE_MISSING, backendHealthState: { state: 'restarting', updatedAt: 1 } })
  missing.onBackendHealth({ state: 'healthy', ok: true, updatedAt: 2 })
  assert.equal(missing.retries, 0)
})

test('the real automatic-restart sequence (degraded → restarting → starting → healthy) counts as a recovery', () => {
  const ed = component({ docLoadFailed: true, statusKey: STATUS_DOWNLOAD_FAILED, backendHealthState: { state: 'healthy', ok: true, updatedAt: 1 } })
  for (const [state, ok, at] of [['degraded', false, 2], ['restarting', false, 3], ['starting', false, 4], ['healthy', true, 5]]) ed.onBackendHealth({ state, ok, updatedAt: at })
  assert.equal(ed.retries, 1, 'the intermediate "starting" must not hide the recovery')
  assert.equal(ed.backendHealthRecoverySeq, 1, 'the save-retry path (B7) sees the same recovery')
  ed.onBackendHealth({ state: 'healthy', ok: true, updatedAt: 6 })
  assert.equal(ed.retries, 1, 'a steady healthy state is not a second recovery')
  const boot = component({ docLoadFailed: false, statusKey: 'ready' })
  boot.onBackendHealth({ state: 'starting', ok: false, updatedAt: 1 }); boot.onBackendHealth({ state: 'healthy', ok: true, updatedAt: 2 })
  assert.equal(boot.backendHealthRecoverySeq, 0, 'an ordinary boot is not a recovery')
})
