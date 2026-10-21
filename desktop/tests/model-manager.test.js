// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createModelManager } = require('../main/services/model-manager')

// 假下载进程：向组件目录落盘字节（整体进度=已落盘字节/estBytes，不再解析
// stdout 百分比——那是单文件 tqdm，多文件会反复 0→100%），随后正常退出
const { MINERU_REQUIRED, saveInventory } = require('../main/services/model-inventory')
function fixtureCode(id) {
  return `
    const fs = require('fs'), path = require('path');
    const dir = path.join(process.cwd(), 'models', ${JSON.stringify(id.replace('-models', ''))});
    const put = (name, value) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, value); };
    if (${JSON.stringify(id)} === 'mineru-models') {
      const root = path.join(dir, 'pipeline');
      for (const name of ${JSON.stringify(MINERU_REQUIRED)}) put('pipeline/' + name + (name.endsWith('.onnx') ? '' : '/weights.bin'), Buffer.alloc(550));
      put('mineru.json', JSON.stringify({'models-dir':{pipeline:root}}));
    } else {
      const asr = ${JSON.stringify(id)} === 'asr-models';
      const repo = asr ? 'Systran--faster-whisper-medium' : 'hexgrad--Kokoro-82M-v1.1-zh';
      const prefix = 'hub/models--' + repo + '/';
      put(prefix + 'refs/main', 'a'.repeat(40));
      const files = asr ? ['config.json','tokenizer.json','vocabulary.json','model.bin']
        : ['config.json','kokoro-v1_1-zh.pth','voices/zf_001.pt','voices/zm_010.pt','voices/af_maple.pt','voices/bf_vale.pt'];
      for (const file of files) put(prefix + 'snapshots/' + 'a'.repeat(40) + '/' + file, file.endsWith('.json') ? '{}' : Buffer.alloc(550));
    }
  `
}
const FAKE_DOWNLOAD_OK = fixtureCode('mineru-models') + `setTimeout(() => process.exit(0), 300)`
// 假下载进程：挂住直到被杀
const FAKE_DOWNLOAD_HANG = `console.log('starting 1%'); setInterval(() => {}, 1000)`
// 假下载进程：直接失败
const FAKE_DOWNLOAD_FAIL = `console.error('boom'); process.exit(3)`

function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'awd-mm-'))
}

function makeManager(dataDir, script, events) {
  return createModelManager({
    dataDir,
    resourcesPath: null,
    packaged: false,
    onProgress: (e) => events.push(e),
    progressPollMs: 50, // 测试提速：整体进度轮询间隔（生产 1s）
    // 测试注入：覆盖真实的 mineru 下载命令
    spawnSpecOverride: () => ({
      cmd: process.execPath,
      args: ['-e', script],
      env: process.env,
      cwd: dataDir
    })
  })
}

function waitFor(cond, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const t = setInterval(() => {
      if (cond()) { clearInterval(t); resolve() }
      else if (Date.now() - start > timeoutMs) { clearInterval(t); reject(new Error('waitFor timeout')) }
    }, 25)
  })
}

test('status lists all registered components (mineru + kokoro + asr)', () => {
  const mm = makeManager(tmpDataDir(), FAKE_DOWNLOAD_OK, [])
  const ids = mm.status().map((c) => c.id).sort()
  assert.deepStrictEqual(ids, ['asr-models', 'kokoro-models', 'mineru-models'])
})

test('status: absent initially, installed after successful download with marker', async () => {
  const dataDir = tmpDataDir()
  const events = []
  const mm = makeManager(dataDir, FAKE_DOWNLOAD_OK, events)
  // 整体进度分母缩到测试规模：假下载落盘 550 字节 → 55%
  mm.component('mineru-models').estBytes = 1000

  assert.strictEqual(mm.isInstalled('mineru-models'), false)
  assert.strictEqual(mm.status().find((c) => c.id === 'mineru-models').state, 'absent')

  const res = await mm.download('mineru-models')
  assert.strictEqual(res.ok, true)
  assert.strictEqual(mm.status().find((c) => c.id === 'mineru-models').state, 'downloading')

  await waitFor(() => mm.isInstalled('mineru-models'))
  assert.strictEqual(mm.status().find((c) => c.id === 'mineru-models').state, 'installed')
  // 进度事件：至少一次字节级整体百分比（55%，且未到 done 前封顶 99）+ 一次 done
  assert.ok(events.some((e) => e.id === 'mineru-models' && e.percent > 0 && e.percent <= 99))
  assert.ok(events.every((e) => e.phase !== 'progress' || e.percent === undefined || e.percent <= 99))
  assert.ok(events.some((e) => e.phase === 'done'))
})

test('download twice rejects while downloading', async () => {
  const dataDir = tmpDataDir()
  const events = []
  const mm = makeManager(dataDir, FAKE_DOWNLOAD_HANG, events)
  await mm.download('mineru-models')
  await assert.rejects(() => mm.download('mineru-models'), /already/)
  await mm.cancel('mineru-models')
})

test('cancel returns state to absent without marker', async () => {
  const dataDir = tmpDataDir()
  const events = []
  const mm = makeManager(dataDir, FAKE_DOWNLOAD_HANG, events)
  await mm.download('mineru-models')
  await mm.cancel('mineru-models')
  await waitFor(() => mm.status().find((c) => c.id === 'mineru-models').state === 'absent')
  assert.strictEqual(mm.isInstalled('mineru-models'), false)
})

test('failed download emits error phase and state error', async () => {
  const dataDir = tmpDataDir()
  const events = []
  const mm = makeManager(dataDir, FAKE_DOWNLOAD_FAIL, events)
  await mm.download('mineru-models')
  await waitFor(() => events.some((e) => e.phase === 'error'))
  assert.strictEqual(mm.status().find((c) => c.id === 'mineru-models').state, 'error')
  assert.strictEqual(mm.isInstalled('mineru-models'), false)
})

test('remove clears installed state', async () => {
  const dataDir = tmpDataDir()
  const events = []
  const mm = makeManager(dataDir, FAKE_DOWNLOAD_OK, events)
  await mm.download('mineru-models')
  await waitFor(() => mm.isInstalled('mineru-models'))
  await mm.remove('mineru-models')
  assert.strictEqual(mm.isInstalled('mineru-models'), false)
  assert.strictEqual(mm.status().find((c) => c.id === 'mineru-models').state, 'absent')
})

// ── 下载源顺序（dev-board#583）：kokoro/asr 先 ModelScope，失败再回落 hf-mirror ──
// 假下载器按 source 决定成败，并把每次被调起的 source 记进 calls.log
const MS_FAIL_LINE = 'error[network]: URLError: <urlopen error boom-ms>'
const HF_FAIL_LINE = 'huggingface_hub.errors.LocalEntryNotFoundError: boom-hf'

function makeSourcedManager(dataDir, behavior, events) {
  const logFile = path.join(dataDir, 'calls.log')
  const mm = createModelManager({
    dataDir,
    resourcesPath: null,
    packaged: false,
    onProgress: (e) => events.push(e),
    progressPollMs: 50,
    spawnSpecOverride: (component, ctx, source) => {
      const mode = behavior[source] || 'fail'
      const failLine = mode === 'disk'
        ? 'error[disk]: OSError: [Errno 28] No space left on device'
        : (source === 'hf' ? HF_FAIL_LINE : MS_FAIL_LINE)
      const body = mode === 'ok'
        ? fixtureCode(component.id) + `console.log('done'); process.exit(0)`
        : mode === 'hang'
          ? `console.log('starting'); setInterval(() => {}, 1000)`
          : `console.log(${JSON.stringify(failLine)}); process.exit(1)`
      return {
        cmd: process.execPath,
        args: ['-e', `require('fs').appendFileSync(${JSON.stringify(logFile)}, ${JSON.stringify(String(source))} + '\\n'); ${body}`],
        env: process.env,
        cwd: dataDir
      }
    }
  })
  const calls = () => {
    try { return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) } catch (e) { return [] }
  }
  return { mm, calls }
}

test('kokoro/asr: ModelScope 成功就不走 hf 回落', async () => {
  const dataDir = tmpDataDir()
  const events = []
  const { mm, calls } = makeSourcedManager(dataDir, { modelscope: 'ok', hf: 'ok' }, events)
  await mm.download('asr-models')
  await waitFor(() => mm.isInstalled('asr-models'))
  assert.deepStrictEqual(calls(), ['modelscope'])
})

test('kokoro/asr: ModelScope 失败回落 hf-mirror，回落成功即装好', async () => {
  const dataDir = tmpDataDir()
  const events = []
  const { mm, calls } = makeSourcedManager(dataDir, { modelscope: 'fail', hf: 'ok' }, events)
  await mm.download('kokoro-models')
  await waitFor(() => mm.isInstalled('kokoro-models'))
  assert.deepStrictEqual(calls(), ['modelscope', 'hf'])
  assert.ok(!events.some((e) => e.phase === 'error'), '回落成功时不该发 error')
})

test('kokoro/asr: 两个源都失败时 message 是人话且附原始异常', async () => {
  const dataDir = tmpDataDir()
  const events = []
  const { mm, calls } = makeSourcedManager(dataDir, { modelscope: 'fail', hf: 'fail' }, events)
  await mm.download('asr-models')
  await waitFor(() => events.some((e) => e.phase === 'error'))
  assert.deepStrictEqual(calls(), ['modelscope', 'hf'])
  const st = mm.status().find((c) => c.id === 'asr-models')
  assert.strictEqual(st.state, 'error')
  assert.match(st.message, /无法连接模型下载源|Could not reach the model download sources/)
  assert.match(st.message, /ModelScope/)
  assert.doesNotMatch(st.message, /^download exited/)
  assert.ok(st.message.includes('boom-ms'), 'ModelScope 的原始异常要附上')
  assert.ok(st.message.includes('LocalEntryNotFoundError: boom-hf'), 'hf 的原始异常要附上')
  const err = events.find((e) => e.phase === 'error')
  assert.strictEqual(err.message, st.message)
})

test('磁盘满时提示空间不足而不是网络', async () => {
  const dataDir = tmpDataDir()
  const events = []
  const { mm } = makeSourcedManager(dataDir, { modelscope: 'disk', hf: 'fail' }, events)
  await mm.download('asr-models')
  await waitFor(() => events.some((e) => e.phase === 'error'))
  assert.match(mm.status().find((c) => c.id === 'asr-models').message, /磁盘空间不足|Not enough disk space/)
})

test('CHECKBA_MODEL_SOURCE=hf 强制只走 hf', async (t) => {
  const prev = process.env.CHECKBA_MODEL_SOURCE
  process.env.CHECKBA_MODEL_SOURCE = 'hf'
  t.after(() => { if (prev === undefined) delete process.env.CHECKBA_MODEL_SOURCE; else process.env.CHECKBA_MODEL_SOURCE = prev })
  const dataDir = tmpDataDir()
  const { mm, calls } = makeSourcedManager(dataDir, { modelscope: 'ok', hf: 'ok' }, [])
  await mm.download('kokoro-models')
  await waitFor(() => mm.isInstalled('kokoro-models'))
  assert.deepStrictEqual(calls(), ['hf'])
})

test('CHECKBA_MODEL_SOURCE=modelscope 失败时不回落', async (t) => {
  const prev = process.env.CHECKBA_MODEL_SOURCE
  process.env.CHECKBA_MODEL_SOURCE = 'modelscope'
  t.after(() => { if (prev === undefined) delete process.env.CHECKBA_MODEL_SOURCE; else process.env.CHECKBA_MODEL_SOURCE = prev })
  const dataDir = tmpDataDir()
  const events = []
  const { mm, calls } = makeSourcedManager(dataDir, { modelscope: 'fail', hf: 'ok' }, events)
  await mm.download('kokoro-models')
  await waitFor(() => events.some((e) => e.phase === 'error'))
  assert.deepStrictEqual(calls(), ['modelscope'])
})

test('ModelScope 下载中取消：不回落 hf、状态回 absent', async () => {
  const dataDir = tmpDataDir()
  const events = []
  const { mm, calls } = makeSourcedManager(dataDir, { modelscope: 'hang', hf: 'ok' }, events)
  await mm.download('asr-models')
  await waitFor(() => calls().length === 1)
  await mm.cancel('asr-models')
  await new Promise((r) => setTimeout(r, 400))
  assert.deepStrictEqual(calls(), ['modelscope'])
  assert.strictEqual(mm.status().find((c) => c.id === 'asr-models').state, 'absent')
})

test('mineru 仍是单一来源，一次调起', async () => {
  const dataDir = tmpDataDir()
  const { mm, calls } = makeSourcedManager(dataDir, { null: 'ok', undefined: 'ok' }, [])
  await mm.download('mineru-models')
  await waitFor(() => mm.isInstalled('mineru-models'))
  assert.strictEqual(calls().length, 1)
})

test('runtime pack 未装时，模型下载当场失败并说清要先装哪个组件', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-nopack-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const mgr = createModelManager({
    dataDir: path.join(root, '.aiworkdeck'),
    resourcesPath: path.join(root, 'res'),
    projectRoot: path.join(root, 'repo'),
    packaged: true,
    onProgress: () => {}
  })
  await assert.rejects(() => mgr.download('kokoro-models'), /kokoro-runtime/)
})

test('completion marker without model files is repairable, not installed', async (t) => {
  const root = tmpDataDir()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const mm = makeManager(root, FAKE_DOWNLOAD_FAIL, [])
  fs.mkdirSync(mm.dirOf('asr-models'), { recursive: true })
  fs.writeFileSync(path.join(mm.dirOf('asr-models'), '.aiworkdeck-complete'), 'old timestamp')
  assert.equal(mm.isInstalled('asr-models'), false)
  assert.equal(mm.stateOf('asr-models'), 'error')
  await mm.download('asr-models')
  await mm.cancel('asr-models')
})

test('successful exit with no model files emits error instead of done', async (t) => {
  const root = tmpDataDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const events = []; const mm = makeManager(root, 'process.exit(0)', events)
  await mm.download('mineru-models')
  await waitFor(() => events.some((e) => e.phase === 'error'))
  assert.equal(mm.isInstalled('mineru-models'), false)
  assert.ok(!events.some((e) => e.phase === 'done'))
})

test('saved inventory detects a missing/truncated model and repairs it without manual deletion', async (t) => {
  const root = tmpDataDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const mm = makeManager(root, fixtureCode('asr-models'), [])
  await mm.download('asr-models'); await waitFor(() => mm.isInstalled('asr-models'))
  const model = path.join(mm.dirOf('asr-models'), 'hub/models--Systran--faster-whisper-medium/snapshots', 'a'.repeat(40), 'model.bin')
  fs.writeFileSync(model, 'truncated')
  assert.equal(mm.isInstalled('asr-models'), false)
  assert.equal(mm.status().find((c) => c.id === 'asr-models').repairRequired, true)
  await mm.download('asr-models'); await waitFor(() => mm.isInstalled('asr-models'))
  assert.equal(fs.statSync(model).size, 550)
})

test('stalled byte progress times out even if downloader keeps printing', async (t) => {
  const root = tmpDataDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const events = []; const mm = makeManager(root, "setInterval(() => console.log('still alive'), 5)", events)
  mm.stallMs = 100
  await mm.download('mineru-models')
  await waitFor(() => events.some((e) => e.phase === 'error'))
  assert.equal(mm.active.size, 0)
  assert.match(events.find((e) => e.phase === 'error').message, /超时|timed out/)
  assert.equal(events.filter((e) => e.phase === 'error').length, 1)
})

test('total deadline stops an endlessly growing download', async (t) => {
  const root = tmpDataDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const events = []; const mm = makeManager(root,
    "const fs=require('fs'); setInterval(() => fs.appendFileSync('models/mineru/growing.incomplete', 'x'), 5)", events)
  mm.stallMs = 1000; mm.totalMs = 120
  await mm.download('mineru-models')
  await waitFor(() => events.some((e) => e.phase === 'error'))
  assert.equal(mm.active.size, 0)
  assert.equal(mm.isInstalled('mineru-models'), false)
})

test('spawn error and subsequent close produce one terminal event', async (t) => {
  const root = tmpDataDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const events = []; const mm = makeManager(root, '', events)
  mm.spawnSpecOverride = () => ({ cmd: path.join(root, 'does-not-exist'), args: [], cwd: root, env: process.env })
  await mm.download('mineru-models')
  await waitFor(() => events.some((e) => e.phase === 'error'))
  await new Promise((r) => setTimeout(r, 70))
  assert.equal(events.filter((e) => e.phase === 'error').length, 1)
  assert.equal(mm.active.size, 0)
})

test('cancel completes once before a new download can replace the job', async (t) => {
  const root = tmpDataDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const events = []; const mm = makeManager(root, FAKE_DOWNLOAD_HANG, events)
  await mm.download('mineru-models')
  await Promise.all([mm.cancel('mineru-models'), mm.cancel('mineru-models')])
  assert.equal(events.filter((e) => e.phase === 'cancelled').length, 1)
  mm.spawnSpecOverride = () => ({ cmd: process.execPath, args: ['-e', FAKE_DOWNLOAD_OK], cwd: root, env: process.env })
  await mm.download('mineru-models'); await waitFor(() => mm.isInstalled('mineru-models'))
  assert.equal(events.filter((e) => e.phase === 'done').length, 1)
})

test('ModelScope explicit repair validates cached hashes and safe paths with synthetic files', () => {
  const { execFileSync } = require('child_process')
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(__dirname, 'model-fetch.test.py')], { stdio: 'pipe' })
})

test('explicit repair can revalidate an installed model while ordinary downloads stay deduplicated', async (t) => {
  const root = tmpDataDir(); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const events = []; const mm = makeManager(root, fixtureCode('asr-models'), events)
  await mm.download('asr-models'); await waitFor(() => mm.isInstalled('asr-models'))
  await assert.rejects(() => mm.download('asr-models'), /already installed/)
  await mm.download('asr-models', { repair: true }); await waitFor(() => mm.isInstalled('asr-models'))
  assert.equal(events.filter((e) => e.phase === 'done').length, 2)
})


test('complete legacy layouts migrate locally without spawning a downloader', () => {
  const { execFileSync } = require('child_process')
  for (const id of ['asr-models', 'kokoro-models', 'mineru-models']) {
    const root = tmpDataDir()
    execFileSync(process.execPath, ['-e', fixtureCode(id)], { cwd: root })
    const mm = makeManager(root, FAKE_DOWNLOAD_FAIL, [])
    const marker = path.join(mm.dirOf(id), '.aiworkdeck-complete')
    fs.writeFileSync(marker, '2026-10-21T01:02:03.000Z')
    assert.strictEqual(mm.isInstalled(id), true)
    assert.strictEqual(JSON.parse(fs.readFileSync(marker, 'utf8')).schema, 1)
    assert.strictEqual(mm.active.size, 0)
  }
})

test('legacy model directory symlink loop is rejected without recursive traversal', () => {
  const { execFileSync } = require('child_process')
  const root = tmpDataDir()
  execFileSync(process.execPath, ['-e', fixtureCode('mineru-models')], { cwd: root })
  const mm = makeManager(root, FAKE_DOWNLOAD_FAIL, [])
  const dir = mm.dirOf('mineru-models')
  fs.symlinkSync(path.join(dir, 'pipeline/models/Layout/PP-DocLayoutV2'), path.join(dir, 'pipeline/models/Layout/PP-DocLayoutV2/loop'), 'dir')
  fs.writeFileSync(path.join(dir, '.aiworkdeck-complete'), '2026-10-21T01:02:03.000Z')
  assert.strictEqual(mm.isInstalled('mineru-models'), false)
})
