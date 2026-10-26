// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/pages/project-overview/librePool.js', import.meta.url), 'utf8')
function harness(limit = 64 * 1024 * 1024) {
  const body = source.replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '')
    .replace(/export const librePoolMethods = \{/, 'return {')
  const timers = new Map()
  const methods = new Function('host', 'isDesktopHost', 'setTimeout', 'clearTimeout', body)(
    { systemMemory: { totalBytes: 32 * 1024 ** 3 }, zetaoffice: { nativeDocxMaxBytes: limit } }, () => true,
    fn => { timers.set(1, fn); return 1 }, id => timers.delete(id))
  const vm = { libreSpares: [{ key: 1, file: null }], libreLruKeys: [], leftFiles: [], rightFiles: [],
    activeFileIdLeft: null, activeFileIdRight: null, splitMode: false, _libreRefs: {}, useLibreEditor: () => true }
  for (const [name, fn] of Object.entries(methods)) vm[name] = fn.bind(vm)
  return { vm, timers }
}

test('an idle WASM spare cannot capture a DOCX selected for the native engine', () => {
  const { vm } = harness()
  for (const file of [{ id: 1, name: '合同.docx', fileSize: 128 }, { id: 2, fileName: '新建.DOCX', fileSize: 0 }]) {
    vm.maybeAdoptLibreSpare(file)
    assert.equal(vm.libreSpares[0].file, null)
  }
})

test('default hosts, other formats and unsupported DOCX sizes keep WASM spare adoption', () => {
  for (const [limit, file] of [
    [null, { id: 1, name: '合同.docx', fileSize: 128 }],
    [64 * 1024 * 1024, { id: 1, name: '表格.xlsx', fileSize: 128 }],
    [64 * 1024 * 1024, { id: 1, name: '大文档.docx', fileSize: 64 * 1024 * 1024 + 1 }],
    [64 * 1024 * 1024, { id: 1, name: '未确定.docx' }],
  ]) {
    const { vm } = harness(limit)
    vm.maybeAdoptLibreSpare(file)
    assert.equal(vm.libreSpares[0].file, file)
  }
})

test('native foreground work does not start an extra WASM engine; spreadsheet warmup resumes', () => {
  const { vm, timers } = harness()
  vm.libreSpares = []
  vm.leftFiles = [{ id: 1, name: '合同.docx', fileSize: 128 }]; vm.activeFileIdLeft = 1
  vm.scheduleLibreSpare()
  assert.equal(timers.size, 0)
  vm.initLibreSpare() // A timer queued before this tab became active must also yield.
  assert.equal(vm.libreSpares.length, 0)
  const file = { id: 2, name: '表格.xlsx', fileSize: 128 }
  vm.leftFiles.push(file); vm.activeFileIdLeft = 2; vm._libreRefs['left:2'] = { file, ready: true }
  vm.scheduleLibreSpare()
  assert.equal(timers.size, 1)
  timers.get(1)()
  assert.equal(vm.libreSpares.length, 1)
})
