// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 剪贴板轮询不许每秒整图解码（dev-board#869）。
//
// 旧轮询在剪贴板是图片时每 tick 都 readImage()+toBitmap()，只为算头尾 64 字节的指纹；
// macOS 上 readImage 是「TIFF 解码 → PNG 编码 → PNG 解码」整一趟，主进程空闲 CPU 7–11%。
// 这里用计数的假 clipboard 钉死：变更序号不变时一次整图都不读；序号变了才读，
// 换图照样推送、同一张图不重复推送、文本路径不受影响。
const test = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')
const { createClipboardPoller, startChangeCounter } = require('../main/clipboard-watch')

function fakeImage(tag, counts) {
  const bytes = Buffer.alloc(4000 * 4, 0)
  bytes.write(tag, 0)
  bytes.write(tag, bytes.length - tag.length)
  return {
    isEmpty: () => false,
    getSize: () => ({ width: 100, height: 10 }),
    toBitmap: () => { counts.toBitmap++; return Buffer.from(bytes) },
    toDataURL: () => 'data:image/png;base64,' + tag,
  }
}

function setup({ withCounter = true } = {}) {
  const counts = { readImage: 0, toBitmap: 0 }
  const board = { formats: ['image/png'], image: fakeImage('A', counts), text: '', seq: 1 }
  const clipboard = {
    read: async () => [{
      types: board.formats.slice(),
      getType: async (type) => {
        if (type.startsWith('image/')) { counts.readImage++; return new Blob([board.image.toDataURL()]) }
        return new Blob([type === 'text/uri-list' ? board.file : board.text])
      },
    }],
  }
  let fp = ''
  const pushed = []
  const poller = createClipboardPoller({
    clipboard,
    decodeImage: bytes => fakeImage(bytes.toString().split(',')[1], counts),
    platform: 'darwin',
    getChangeCount: () => (withCounter ? board.seq : null),
    fingerprint: { get: () => fp, set: (v) => { fp = v } },
    onImage: (d) => pushed.push({ type: 'IMAGE', d }),
    onFile: (p) => pushed.push({ type: 'FILE', p }),
    onText: (t) => pushed.push({ type: 'TEXT', t }),
  })
  let primed = false
  const tick = async () => { const priming = !primed; primed = true; await poller.tick(priming) }
  return { counts, board, pushed, tick, poller, clipboard, getFingerprint: () => fp, setFingerprint: value => { fp = value } }
}

test('同一张图连续轮询：只在首 tick 读一次整图，之后不再 readImage/toBitmap', async () => {
  const { counts, pushed, tick } = setup()
  for (let i = 0; i < 10; i++) await tick()
  assert.strictEqual(counts.readImage, 1)
  assert.strictEqual(counts.toBitmap, 1)
  assert.deepStrictEqual(pushed, [], '启动前就在剪贴板里的图不算新复制')
})

test('换图后（序号前进）检测到并只推送一次', async () => {
  const { counts, board, pushed, tick } = setup()
  await tick()
  await tick()
  board.image = fakeImage('B', counts)
  board.seq = 2
  for (let i = 0; i < 5; i++) await tick()
  assert.deepStrictEqual(pushed.map(p => p.d), ['data:image/png;base64,B'])
  assert.strictEqual(counts.readImage, 2, '序号变化那一次读图，其余 tick 不读')
})

test('同一张图被重新复制（序号前进、内容不变）：读一次比指纹，不重复推送', async () => {
  const { counts, board, pushed, tick } = setup()
  await tick()
  board.seq = 2
  await tick()
  await tick()
  assert.deepStrictEqual(pushed, [])
  assert.strictEqual(counts.readImage, 2)
})

test('图 → 文本 → 同一张图：文本照常推送，图重新出现时再推一次（与旧行为一致）', async () => {
  const { board, pushed, tick } = setup()
  await tick()
  board.formats = ['text/plain']
  board.text = '  甲方  '
  board.seq = 2
  await tick()
  await tick()
  board.formats = ['image/png']
  board.seq = 3
  await tick()
  assert.deepStrictEqual(pushed.map(p => p.type + ':' + (p.t || p.d)), ['TEXT:甲方', 'IMAGE:data:image/png;base64,A'])
})

test('无变更序号兜底：同一张图连续 10 tick 只整图读 2 次（首 tick + 第 6 tick）', async () => {
  const { counts, pushed, tick } = setup({ withCounter: false })
  const readAt = []
  for (let i = 1; i <= 10; i++) {
    const before = counts.readImage
    await tick()
    if (counts.readImage > before) readAt.push(i)
  }
  assert.deepStrictEqual(readAt, [1, 6])
  assert.strictEqual(counts.toBitmap, 2)
  assert.deepStrictEqual(pushed, [])
})

test('无变更序号兜底：formats 变化的 tick 立刻重读（新图与图→文本→图都不等 5 秒）', async () => {
  const { counts, board, pushed, tick } = setup({ withCounter: false })
  await tick()
  // 新图带来不同的格式集：当 tick 就读、就推
  board.formats = ['image/png', 'text/html']
  board.image = fakeImage('B', counts)
  await tick()
  assert.strictEqual(counts.readImage, 2)
  // 图 → 文本 → 图（格式集回到只有图）：每次变化当 tick 处理
  board.formats = ['text/plain']
  board.text = '乙方'
  await tick()
  board.formats = ['image/png']
  board.image = fakeImage('C', counts)
  await tick()
  assert.strictEqual(counts.readImage, 3)
  assert.deepStrictEqual(pushed.map(p => p.type + ':' + (p.t || p.d)), [
    'IMAGE:data:image/png;base64,B', 'TEXT:乙方', 'IMAGE:data:image/png;base64,C',
  ])
})

test('无变更序号兜底：图换图且格式集不变，最迟第 5 个 tick 后检测到', async () => {
  const { counts, board, pushed, tick } = setup({ withCounter: false })
  await tick()
  board.image = fakeImage('B', counts)
  for (let i = 0; i < 4; i++) await tick()
  assert.deepStrictEqual(pushed, [], '节流窗口内不读图')
  await tick()
  assert.deepStrictEqual(pushed.map(p => p.d), ['data:image/png;base64,B'])
  assert.strictEqual(counts.readImage, 2)
})

test('startChangeCounter：非 darwin 返回 null；darwin 解析 helper 输出的最后一行，退出后回 null', async () => {
  assert.strictEqual(startChangeCounter({ platform: 'win32', spawnFn: () => { throw new Error('不该起') } }), null)

  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  let killed = false
  child.kill = () => { killed = true }
  let spawned = null
  const counter = startChangeCounter({ platform: 'darwin', spawnFn: (cmd, args) => { spawned = { cmd, args }; return child } })
  assert.strictEqual(spawned.cmd, '/usr/bin/osascript')
  assert.deepStrictEqual(spawned.args.slice(0, 2), ['-l', 'JavaScript'])
  assert.strictEqual(counter.get(), null)
  child.stdout.emit('data', '770\n77')
  assert.strictEqual(counter.get(), 770)
  child.stdout.emit('data', '1\n772\n')
  assert.strictEqual(counter.get(), 772)
  child.emit('exit', 0)
  assert.strictEqual(counter.get(), null, 'helper 退出后必须退回无序号，不能卡在旧值上把换图吞掉')
  counter.stop()
  assert.strictEqual(killed, true)
})

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('Promise/Blob 文本与原生文件引用：忽略 URI 列表注释并正确解码中文路径', async () => {
  const { board, pushed, tick } = setup()
  await tick()
  board.formats = ['text/uri-list']
  board.file = '# native file\r\nfile:///tmp/%E5%90%88%E5%90%8C%20A.docx\r\n'
  board.seq++
  await tick()
  assert.deepStrictEqual(pushed, [{ type: 'FILE', p: '/tmp/合同 A.docx' }])
  board.file = 'https://example.com/case.docx'
  await tick()
  assert.strictEqual(pushed.length, 1, '网页链接不能变成本机文件读取授权')
})

test('异步读取进行中不重入；停止后迟到的 Blob 不更新指纹或推送', async () => {
  const { clipboard, board, pushed, tick, poller } = setup()
  await tick()
  board.formats = ['text/plain']
  board.text = '迟到文本'
  const pending = deferred()
  let reads = 0
  clipboard.read = async () => { reads++; return [{ types: ['text/plain'], getType: () => pending.promise }] }
  const first = tick()
  await Promise.resolve()
  await tick()
  assert.strictEqual(reads, 1)
  poller.cancel()
  pending.resolve(new Blob(['迟到文本']))
  await first
  assert.deepStrictEqual(pushed, [])
  await tick()
  assert.deepStrictEqual(pushed, [{ type: 'TEXT', t: '迟到文本' }], '取消不能留下迟到的去重指纹')
})

test('拒绝的 Promise 交给调用方，后续轮询仍能恢复', async () => {
  const { clipboard, board, pushed, tick } = setup()
  await tick()
  const original = clipboard.read
  clipboard.read = async () => { throw new Error('clipboard unavailable') }
  await assert.rejects(tick(), /clipboard unavailable/)
  clipboard.read = original
  board.formats = ['text/plain']
  board.text = '恢复'
  await tick()
  assert.deepStrictEqual(pushed, [{ type: 'TEXT', t: '恢复' }])
})

test('主进程复制监听等待 readText Promise，读取失败不发送，销毁后不发送迟到内容', async () => {
  const fs = require('node:fs')
  const vm = require('node:vm')
  const source = fs.readFileSync(require.resolve('../main/main.js'), 'utf8')
  const body = source.slice(source.indexOf('function attachCopyListener('), source.indexOf('// 官网头像'))
  const pending = deferred()
  const sent = [], timers = []
  const context = {
    clipboard: { readText: () => pending.promise },
    emitClipboard: (text) => sent.push(text),
    setTimeout: (fn) => timers.push(fn),
  }
  vm.runInNewContext(body + '; this.attach = attachCopyListener', context)
  const wc = new EventEmitter()
  let destroyed = false
  wc.isDestroyed = () => destroyed
  context.attach(wc, 'test')
  wc.emit('before-input-event', {}, { type: 'keyDown', key: 'c', control: true })
  const copy = timers.shift()()
  await Promise.resolve()
  assert.deepStrictEqual(sent, [])
  pending.resolve('合成文本')
  await copy
  assert.deepStrictEqual(sent, ['合成文本'])
  const late = deferred()
  context.clipboard.readText = () => late.promise
  wc.emit('before-input-event', {}, { type: 'keyDown', key: 'x', meta: true })
  const cut = timers.shift()()
  destroyed = true
  late.resolve('不应发送')
  await cut
  assert.deepStrictEqual(sent, ['合成文本'])
  destroyed = false
  context.clipboard.readText = async () => { throw new Error('denied') }
  wc.emit('before-input-event', {}, { type: 'keyDown', key: 'c', control: true })
  await timers.shift()()
  assert.deepStrictEqual(sent, ['合成文本'])
})


test('主进程停止会取消读取；忙碌或失败不会耗掉重启后的首轮预读', async () => {
  const fs = require('node:fs')
  const vm = require('node:vm')
  const source = fs.readFileSync(require.resolve('../main/main.js'), 'utf8')
  const body = source.slice(source.indexOf('function startClipboardWatcher('), source.indexOf('function attachCopyListener('))
  const callbacks = [], pending = deferred(), priming = []
  let cancels = 0, calls = 0
  const context = {
    clipboardWatchTimer: null, clipboardPrimed: false, clipboardChangeCounter: null,
    startChangeCounter: () => null,
    setInterval: fn => { callbacks.push(fn); return callbacks.length }, clearInterval: () => {},
    clipboardPoller: {
      cancel: () => { cancels++ },
      tick: async prime => {
        priming.push(prime)
        calls++
        if (calls === 1) return pending.promise
        if (calls === 2) return false
        if (calls === 3) throw Error('temporarily unavailable')
        return true
      },
    },
  }
  vm.runInNewContext(body + '; this.start = startClipboardWatcher; this.stop = stopClipboardWatcher', context)
  context.start()
  const old = callbacks[0]()
  context.stop()
  assert.strictEqual(cancels, 1)
  context.start()
  pending.resolve(true)
  await old
  assert.strictEqual(context.clipboardPrimed, false, '旧轮次不能修改新定时器的预读状态')
  await callbacks[1]()
  await callbacks[1]()
  await callbacks[1]()
  assert.deepStrictEqual(priming, [true, true, true, true])
  assert.strictEqual(context.clipboardPrimed, true)
})

for (const type of ['image/png', 'text/plain', 'text/uri-list']) {
  test(`迟到 ${type} Blob 不覆盖复制监听已推进的指纹，也不消耗预读`, async () => {
    for (const priming of [false, true]) {
      const { clipboard, board, pushed, tick, poller, getFingerprint, setFingerprint } = setup()
      await tick()
      board.seq++
      const originalRead = clipboard.read
      const pending = deferred()
      clipboard.read = async () => [{ types: [type], getType: async () => ({
        arrayBuffer: () => pending.promise,
        text: () => pending.promise,
      }) }]
      const stale = poller.tick(priming)
      await new Promise(resolve => setImmediate(resolve))
      // 与 main.js 的 emitClipboard 一致：键盘复制先推进共享指纹并通知前端。
      setFingerprint('TXT_new copy')
      pushed.push({ type: 'TEXT', t: 'new copy' })
      pending.resolve(type === 'image/png' ? Buffer.from('data:image/png;base64,OLD') :
        type === 'text/uri-list' ? 'file:///tmp/old.docx' : 'old text')
      assert.strictEqual(await stale, false, '过期结果不是一次完成的预读')
      assert.strictEqual(getFingerprint(), 'TXT_new copy')
      assert.deepStrictEqual(pushed, [{ type: 'TEXT', t: 'new copy' }])
      clipboard.read = originalRead
      board.formats = ['text/plain']
      board.text = 'new copy'
      await poller.tick(priming)
      assert.strictEqual(pushed.length, 1, '下一轮不能重复推送已经复制过的新文本')
      board.text = 'later copy'
      await poller.tick(false)
      assert.deepStrictEqual(pushed.map(p => p.t), ['new copy', 'later copy'])
    }
  })
}
