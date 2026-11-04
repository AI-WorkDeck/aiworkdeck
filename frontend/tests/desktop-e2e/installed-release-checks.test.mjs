// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertDocumentBinding, assertEvidenceEntryScope, nativeClose } from './installed-release-checks.mjs'

test('release assertion rejects stale Writer binding and missing evidence entry', () => {
  const writer = { fileId: 42, insightDocFileId: 42, insightInstalled: true, insightAvailable: true }
  assert.doesNotThrow(() => assertDocumentBinding(writer, 'docx'))
  assert.throws(() => assertDocumentBinding({ ...writer, insightDocFileId: 41 }, 'docx'))
  assert.throws(() => assertDocumentBinding({ ...writer, insightAvailable: false }, 'docx'))
})
test('release assertion rejects evidence leaking into spreadsheet or presentation', () => {
  for (const ext of ['xlsx', 'pptx', 'pdf']) {
    const state = { fileId: 43, insightDocFileId: null, insightInstalled: true, insightAvailable: false }
    assert.doesNotThrow(() => assertDocumentBinding(state, ext))
    assert.throws(() => assertDocumentBinding({ ...state, insightDocFileId: 42 }, ext))
    assert.throws(() => assertDocumentBinding({ ...state, insightAvailable: true }, ext))
  }
})
test('native close rejects invalid target before invoking any OS command', () => {
  for (const pid of [0, -1, '123', 1.5, NaN]) assert.throws(() => nativeClose(pid))
})

test('evidence requires visible entry in named project while preserving loose-file boundary', () => {
  assert.doesNotThrow(() => assertEvidenceEntryScope({ hasNamedProject: false, isLooseWorkspace: true }, undefined))
  assert.throws(() => assertEvidenceEntryScope({ hasNamedProject: true, isLooseWorkspace: false }, undefined))
  assert.doesNotThrow(() => assertEvidenceEntryScope({ hasNamedProject: true, isLooseWorkspace: false }, {}))
  assert.throws(() => assertEvidenceEntryScope({ hasNamedProject: false, isLooseWorkspace: true }, {}))
})
