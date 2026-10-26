// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Execute the actual IPC handler; neither the native nor WASM engine needs to
// run to verify which service receives a comparison, spare, or file request.
function harness({ platform = 'darwin', engine = 'lok', failNative = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8')
  const start = source.indexOf('let nativeEditorManager = null')
  const end = source.indexOf('// 编辑器本机字体', start)
  assert.ok(start >= 0 && end > start)
  const handlers = new Map(), calls = []
  const dependencies = {
    './native/editor-ipc': { createNativeEditorManager: () => ({
      open: async (_sender, options) => {
        calls.push({ engine: 'lok', options })
        if (failNative) throw Error('Native runtime unavailable')
        return { kind: 'native', engine: 'lok' }
      },
    }) },
    './zetaoffice-session': { ZETAOFFICE_PARTITION: 'test-partition', installZetaOfficeIsolation: () => {} },
    './zetaoffice-server': { startEditorServer: async () => { calls.push({ engine: 'wasm' }); return { origin: 'http://owned-test' } },
      editorUrl: origin => origin + '/editor' },
    './app-language': { getAppLanguage: () => 'zh-CN', getLowaUiLang: () => 'zh-CN' },
    url: require('node:url'),
  }
  vm.runInNewContext(source.slice(start, end), {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    process: { platform, env: { AWD_EDITOR_ENGINE: engine } },
    app: { getPath: () => '/owned-test' }, path, __dirname: '/owned-test/main',
    require: name => { assert.ok(dependencies[name], name); return dependencies[name] },
  })
  return { calls, open: options => handlers.get('checkba:zetaoffice-editor')({ sender: {} }, options) }
}

test('explicit DOCX editors use the opted-in native engine, including readonly and new files', async () => {
  for (const options of [{ name: '合同.docx', size: 1024, readOnly: false }, { name: '合同.DOCX', size: 64 * 1024 * 1024, readOnly: true }, { name: '新建.docx', size: 0, empty: true, readOnly: false }]) {
    const app = harness()
    assert.equal((await app.open(options)).engine, 'lok')
    assert.equal(app.calls[0].options, options)
  }
})

test('comparison, merge and generic spare requests retain their complete WASM service', async () => {
  for (const options of [undefined, {}, { empty: true, readOnly: false }, { name: 'a.docx' }]) {
    const app = harness()
    assert.equal((await app.open(options)).url, 'http://owned-test/editor')
    assert.deepEqual(app.calls, [{ engine: 'wasm' }])
  }
})

test('unsupported formats, Windows, and the default engine keep the existing editor', async () => {
  for (const name of ['a.doc', 'a.xlsx', 'a.xls', 'a.pptx', 'a.ppt', 'a.odt']) {
    const app = harness()
    assert.equal((await app.open({ name, readOnly: false })).url, 'http://owned-test/editor')
  }
  for (const settings of [{ platform: 'win32' }, { engine: undefined }, { engine: '' }]) {
    const app = harness(settings.engine === undefined && !settings.platform ? { engine: '' } : settings)
    assert.equal((await app.open({ name: 'a.docx', readOnly: false })).url, 'http://owned-test/editor')
  }
})

test('a selected native engine failure remains visible and never replays through another engine', async () => {
  const app = harness({ failNative: true })
  await assert.rejects(app.open({ name: 'a.docx', size: 1024, readOnly: false }), /runtime unavailable/)
  assert.equal(app.calls.length, 1)
  assert.equal(app.calls[0].engine, 'lok')
})

test('large and unknown-size DOCX use the existing engine before a native model is created', async () => {
  for (const size of [undefined, null, NaN, -1, '1024', 64 * 1024 * 1024 + 1]) {
    const app = harness()
    assert.equal((await app.open({ name: 'large.docx', readOnly: false, size })).url, 'http://owned-test/editor', String(size))
    assert.deepEqual(app.calls, [{ engine: 'wasm' }])
  }
})
