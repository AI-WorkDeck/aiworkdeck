// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertDocumentBinding, assertEvidenceEntryScope, looseWorkspaceURL, nativeClose, windowsCloseScript, isInstalledH5URL } from './installed-release-checks.mjs'

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

test('named-project QA returns to the captured loose identity even when browser URL is the startup shell', () => {
  const base = 'http://127.0.0.1:19566/h5/index.html'
  for (const original of [base, `${base}#/pages/project-overview/project-overview`, `${base}#/pages/project-overview/project-overview?id=99`]) {
    assert.equal(looseWorkspaceURL(original, 7), `${base}#/pages/project-overview/project-overview?id=7&loose=1`)
  }
  for (const id of [undefined, 0, -1, '7']) assert.throws(() => looseWorkspaceURL(base, id))
})


test('Windows close command rejects foreign or malformed native targets before OS invocation', () => {
  const valid = { pid: 123, hwnd: '456' }
  assert.match(windowsCloseScript(123, valid), /GetWindowThreadProcessId/)
  assert.match(windowsCloseScript(123, valid), /IsWindowVisible/)
  assert.match(windowsCloseScript(123, valid), /PostMessage\(\$h, 0x0112/)
  for (const target of [undefined, { ...valid, pid: 124 }, { ...valid, hwnd: '0' }, { ...valid, hwnd: '1; Stop-Process' }, { ...valid, hwnd: '9223372036854775808' }]) {
    assert.throws(() => windowsCloseScript(123, target))
  }
})

test('native close locates packaged file and loopback H5 URLs without selecting auxiliary windows', () => {
  for (const url of ['file:///D:/a/_temp/app/resources/frontend/dist/build/h5/index.html#/pages/welcome', 'http://127.0.0.1:19566/h5/index.html']) assert.equal(isInstalledH5URL(url), true)
  for (const url of ['about:blank', 'file:///D:/app/editor.html', 'http://127.0.0.1/about.html', 'invalid']) assert.equal(isInstalledH5URL(url), false)
})
