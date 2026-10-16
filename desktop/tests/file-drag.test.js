// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 资源管理器 / 暂存区文件直接拖出软件外部（如微信聊天、Finder、资源管理器，dev-board#1288）。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const electronId = require.resolve('electron')
const fakeIcon = { isEmpty: () => false, kind: 'png-icon' }
require.cache[electronId] = {
  id: electronId,
  filename: electronId,
  loaded: true,
  exports: {
    ipcMain: { handle() {}, on() {} },
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
  assert.match(PRELOAD, /ipcRenderer\.send\('fs:startDrag',\s*\{\s*paths\s*\}\)/)
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
