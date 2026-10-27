// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 资源管理器 / 暂存区文件直接拖出软件外部（如微信聊天、Finder、资源管理器，dev-board#1288）。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const electronId = require.resolve('electron')
const ipcHandlers = new Map()
const fakeIcon = { isEmpty: () => false, kind: 'png-icon' }
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: {
    ipcMain: { handle(name, handler) { ipcHandlers.set(name, handler) }, on() {} },
    dialog: {},
    shell: {},
    BrowserWindow: {},
    ShareMenu: class {},
    nativeImage: {
      createFromDataURL(url) {
        assert.match(url, /^data:image\/png;base64,/)
        return fakeIcon
      },
    },
  },
}
const svc = require('../main/file-service')

const SRC = fs.readFileSync(path.join(__dirname, '../main/file-service.js'), 'utf8')
const PRELOAD = fs.readFileSync(path.join(__dirname, '../preload/preload.js'), 'utf8')

test('preload 暴露 fs.startDrag，走 fs:startDrag 通道', () => {
  assert.match(PRELOAD, /startDrag:\s*\(path\)\s*=>/)
  assert.match(PRELOAD, /return ipcRenderer\.invoke\('fs:startDrag',\s*\{\s*paths\s*\}\)/)
})

test('主进程同时登记 ipcMain.on / ipcMain.handle 的 fs:startDrag', () => {
  assert.match(SRC, /ipcMain\.on\('fs:startDrag'/)
  assert.match(SRC, /ipcMain\.handle\('fs:startDrag'/)
})

test('startFileDrag：对真实存在的文件调用 sender.startDrag({ files, icon })', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-drag-test-'))
  const filePath = path.join(tmpDir, '委托代理合同.docx')
  fs.writeFileSync(filePath, 'hello')
  try {
    const dragged = []
    const sender = {
      startDrag(payload) {
        dragged.push(payload)
      },
    }
    const res = svc.startFileDrag(sender, filePath)
    assert.deepEqual(res, { ok: true, path: filePath })
    assert.equal(dragged.length, 1)
    assert.deepEqual(dragged[0].files, [filePath])
    assert.equal(dragged[0].icon, fakeIcon)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('startFileDrag：拒绝相对路径、未归一化路径、不存在路径与目录', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-drag-dir-'))
  try {
    const dragged = []
    const sender = { startDrag: (p) => dragged.push(p) }
    assert.equal(svc.startFileDrag(sender, 'relative/a.docx').ok, false)
    assert.equal(svc.startFileDrag(sender, `${tmpDir}/../${path.basename(tmpDir)}/a.docx`).reason, 'not-normalized')
    assert.equal(svc.startFileDrag(sender, path.join(tmpDir, 'missing.docx')).reason, 'not-found')
    assert.equal(svc.startFileDrag(sender, tmpDir).reason, 'not-file')
    assert.equal(dragged.length, 0)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})


test('startFileDrag：两份文件整组交给系统，去重且任一无效不部分启动', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-drag-batch-'))
  try {
    const files = ['甲 合同.docx', '乙 材料.pdf'].map(name => path.join(tmpDir, name))
    files.forEach(file => fs.writeFileSync(file, 'synthetic'))
    const calls = []
    const sender = { startDrag: payload => calls.push(payload) }
    assert.deepEqual(svc.startFileDrag(sender, files), { ok: true, paths: files })
    assert.deepEqual(calls, [{ files, icon: fakeIcon }])
    calls.length = 0
    assert.equal(svc.startFileDrag(sender, [files[0], path.join(tmpDir, 'missing')]).reason, 'not-found')
    assert.equal(svc.startFileDrag(sender, [files[0], tmpDir]).reason, 'not-file')
    assert.equal(svc.startFileDrag(sender, [files[0], 'relative']).reason, 'bad-path')
    assert.equal(svc.startFileDrag(sender, []).reason, 'bad-path')
    assert.deepEqual(calls, [])
    assert.deepEqual(svc.startFileDrag(sender, [files[0], files[0]]), { ok: true, paths: [files[0]] })
    assert.deepEqual(calls[0].files, [files[0]])
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})


test('archive cache preserves original names and exact bytes in private temp directories until explicit process cleanup', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-archive-test-'))
  const store = svc.createArchiveEntryCache({ tempDir })
  try {
    const backing = Uint8Array.of(99, 0, 255, 10, 99)
    const bytes = backing.subarray(1, 4)
    const first = await store.cache({ name: '现场照片.jpg', bytes })
    const second = await store.cache({ name: '现场照片.jpg', bytes: bytes.slice().buffer })
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(first.path, second.path, 'reselecting unchanged bytes must reuse the cached file')
    assert.equal(path.basename(first.path), '现场照片.jpg')
    assert.deepEqual(fs.readFileSync(first.path), Buffer.from([0, 255, 10]))
    if (process.platform !== 'win32') assert.equal(fs.statSync(first.path).mode & 0o777, 0o600)
    const dragged = []
    assert.equal(svc.startFileDrag({ startDrag: value => dragged.push(value) }, first.path).ok, true)
    assert.equal(fs.existsSync(first.path), true, 'starting native export must not delete bytes needed by the receiving app')
    assert.deepEqual(dragged[0].files, [first.path])
    const empty = await store.cache({ name: '空文件.txt', bytes: new ArrayBuffer(0) })
    assert.equal(empty.ok, true)
    assert.equal(fs.statSync(empty.path).size, 0)
    store.clear()
    assert.deepEqual(fs.readdirSync(tempDir), [])
    assert.equal((await store.cache({ name: 'x', bytes })).reason, 'closed')
  } finally {
    store.clear()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('archive cache rejects traversal, unsafe cross-platform names, nonbytes and files over 128MiB without writing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-archive-test-'))
  const store = svc.createArchiveEntryCache({ tempDir })
  try {
    for (const name of ['', '.', '..', '../escape', '/tmp/escape', 'a\\b', 'C:escape', 'a\0b', 'CON', 'nul.txt', 'x?', 'x.', 'x ', '照'.repeat(86)]) {
      assert.equal((await store.cache({ name, bytes: Uint8Array.of(1) })).reason, 'bad-name', name)
    }
    assert.equal((await store.cache({ name: 'x', bytes: '/tmp/private' })).reason, 'bad-bytes')
    assert.equal(svc.ARCHIVE_ENTRY_MAX_BYTES, 128 * 1024 * 1024)
    assert.equal((await store.cache({ name: 'x', bytes: new ArrayBuffer(svc.ARCHIVE_ENTRY_MAX_BYTES + 1) })).reason, 'too-large')
    assert.deepEqual(fs.readdirSync(tempDir), [])
  } finally {
    store.clear()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('archive cache cleanup during async materialization leaves no temporary files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-archive-test-'))
  const store = svc.createArchiveEntryCache({ tempDir })
  try {
    const pending = store.cache({ name: 'fixture.txt', bytes: Uint8Array.of(1) })
    store.clear()
    assert.equal((await pending).reason, 'closed')
    assert.deepEqual(fs.readdirSync(tempDir), [])
  } finally {
    store.clear()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('archive cache IPC accepts only main-frame byte payloads and preload exposes the restricted endpoint', async () => {
  svc.initLocalFileService()
  const mainFrame = {}
  const handler = ipcHandlers.get('fs:cacheArchiveEntry')
  const payload = { name: 'synthetic-archive-entry.txt', bytes: Uint8Array.of(1) }
  assert.equal((await handler({ senderFrame: {}, sender: { mainFrame } }, payload)).reason, 'not-main-frame')
  assert.equal((await handler({ senderFrame: mainFrame, sender: { mainFrame } }, { ...payload, name: '../escape' })).reason, 'bad-name')
  const result = await handler({ senderFrame: mainFrame, sender: { mainFrame } }, payload)
  assert.equal(result.ok, true)
  assert.deepEqual(fs.readFileSync(result.path), Buffer.from([1]))
  assert.match(PRELOAD, /cacheArchiveEntry:.*ipcRenderer\.invoke\('fs:cacheArchiveEntry', file\)/)
  fs.rmSync(path.dirname(result.path), { recursive: true, force: true })
})


test('archive cache reuses concurrent same-name same-byte requests but preserves changed bytes and different names', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-archive-test-'))
  const store = svc.createArchiveEntryCache({ tempDir })
  try {
    const payload = { name: '现场照片.jpg', bytes: Uint8Array.of(1, 2, 3) }
    const repeated = await Promise.all(Array.from({ length: 25 }, () => store.cache(payload)))
    assert.equal(repeated.every(result => result.ok), true)
    assert.equal(new Set(repeated.map(result => result.path)).size, 1)
    assert.equal(fs.readdirSync(tempDir).length, 1, 'concurrent preview requests materialize only one copy')
    const renamed = await store.cache({ ...payload, name: '第二张.jpg' })
    const changed = await store.cache({ ...payload, bytes: Uint8Array.of(4, 5, 6) })
    assert.notEqual(renamed.path, repeated[0].path)
    assert.notEqual(changed.path, repeated[0].path)
    assert.equal(path.basename(renamed.path), '第二张.jpg')
    assert.deepEqual(fs.readFileSync(changed.path), Buffer.from([4, 5, 6]))
    assert.deepEqual(fs.readFileSync(repeated[0].path), Buffer.from([1, 2, 3]), 'old drag recipients keep their original bytes')
    assert.equal(fs.readdirSync(tempDir).length, 3)
  } finally {
    store.clear()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
