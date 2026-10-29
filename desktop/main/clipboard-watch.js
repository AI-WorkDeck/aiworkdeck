// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 系统剪贴板轮询（dev-board#869）。
//
// 现场：剪贴板里躺着一张图时，主进程空闲 CPU 7–11%。旧轮询每秒 readImage() 一次——
// macOS 上那是「TIFF 解码 → PNG 编码 → PNG 再解码」整一趟（2010x1466 实测 71ms/次），
// 再 toBitmap() 复制一整份 BGRA，只为取头尾 64 字节算指纹。成本随图片尺寸线性涨。
//
// 现在：macOS 用 NSPasteboard.changeCount 当廉价闸门——序号没变就说明还是上一次复制，
// 图片指纹不用重算；序号变了才读一次整图，指纹比对与推送逻辑与旧代码逐字一致
// （同一张图重复复制不重复推送、图文混合优先图、首 tick 只记指纹）。
// Electron 不暴露 changeCount，由一个常驻的 /usr/bin/osascript（JXA）每 0.5 秒读一次、
// 只在变化时写一行到 stdout；父进程没了它自己退出。
//
// 其余平台（Windows 的 GetClipboardSequenceNumber 同样没暴露）与 helper 起不来/中途退出时，
// getChangeCount() 返回 null，走廉价兜底：每 tick 先看 clipboard.read() 的类型清单（延迟取 Blob），
// 格式集与上一 tick 完全相同时整图只每 IMAGE_RECHECK_TICKS 个 tick 重读一次；格式集一变
// （复制了文本/文件/格式不同的新图）当 tick 立刻重读。文本与文件分支照旧每 tick。
// 取舍：「图换图且格式集不变」（例如连截两张图）的检测最多晚 IMAGE_RECHECK_TICKS 秒，
// 换来图躺在剪贴板里时整图解码的次数降到五分之一。
const { spawn } = require('child_process')
const { fileURLToPath } = require('node:url')

// 无变更序号时，格式集不变的情况下每几个 tick 才整图重读一次（tick 间隔 1 秒）
const IMAGE_RECHECK_TICKS = 5

// 父进程 pid 变了（被 launchd 收养）就退出，防止主进程崩溃后留下孤儿。
const DARWIN_CHANGE_COUNT_SCRIPT = `
ObjC.import('AppKit'); ObjC.import('unistd')
var pb = $.NSPasteboard.generalPasteboard
var out = $.NSFileHandle.fileHandleWithStandardOutput
var ppid = $.getppid(), last = -1
while ($.getppid() === ppid) {
  var c = pb.changeCount
  if (c !== last) { last = c; out.writeData($(String(c) + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)) }
  delay(0.5)
}
`

/**
 * 起剪贴板变更序号的读取器。不支持的平台返回 null。
 * @returns {{ get: () => (number|null), stop: () => void } | null}
 */
function startChangeCounter({ platform = process.platform, spawnFn = spawn } = {}) {
  if (platform !== 'darwin') return null
  let child
  try {
    child = spawnFn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', DARWIN_CHANGE_COUNT_SCRIPT], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (e) {
    return null
  }
  let value = null
  let alive = true
  let buf = ''
  const die = () => { alive = false; value = null }
  child.on('error', die)
  child.on('exit', die)
  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      buf += String(chunk)
      const lines = buf.split('\n')
      buf = lines.pop()
      for (let i = lines.length - 1; i >= 0; i--) {
        const n = Number(lines[i].trim())
        if (lines[i].trim() && Number.isFinite(n)) { if (alive) value = n; break }
      }
    })
  }
  return {
    get: () => value,
    stop: () => {
      alive = false
      value = null
      try { child.kill() } catch (e) { /* ignore */ }
    },
  }
}

/**
 * 一次轮询的逻辑（不含定时器）。fingerprint 与 main.js 的 emitClipboard 共用，
 * 由调用方以 get/set 传入。
 */
function createClipboardPoller({ clipboard, platform = process.platform, getChangeCount = () => null, fingerprint, onImage, onFile, onText,
  decodeImage = bytes => require('electron').nativeImage.createFromBuffer(bytes) }) {
  let imageSeq = null
  let lastFormatsKey = null
  let ticksSinceImageRead = Infinity
  let lastImageNonEmpty = false
  let busy = false
  let generation = 0

  async function tick(priming) {
    if (busy) return false
    busy = true
    const current = generation
    try {
      const initialFingerprint = fingerprint.get()
      // copy/cut 监听也会推进共享指纹；异步读取不能用旧结果覆盖它。
      const isCurrent = () => current === generation && fingerprint.get() === initialFingerprint
      const items = await clipboard.read()
      if (!isCurrent()) return false
      const formats = [...new Set(items.flatMap(item => item.types))]
      const formatsKey = formats.join('\n')
      const formatsChanged = formatsKey !== lastFormatsKey
      lastFormatsKey = formatsKey
      ticksSinceImageRead++
      const itemFor = type => items.find(item => item.types.includes(type))
      const imageType = formats.includes('image/png') ? 'image/png' : formats.find(type => type.startsWith('image/'))

      if (imageType) {
        const seq = getChangeCount()
        if (seq != null && seq === imageSeq) return true
        if (seq == null && lastImageNonEmpty && !formatsChanged && ticksSinceImageRead < IMAGE_RECHECK_TICKS) return true
        const blob = await itemFor(imageType).getType(imageType)
        if (!isCurrent()) return false
        const bytes = Buffer.from(await blob.arrayBuffer())
        if (!isCurrent()) return false
        const img = decodeImage(bytes)
        ticksSinceImageRead = 0
        lastImageNonEmpty = !!(img && !img.isEmpty())
        if (lastImageNonEmpty) {
          imageSeq = seq
          const bitmap = img.toBitmap()
          const size = img.getSize()
          const sample = bitmap.length > 64
            ? bitmap.subarray(0, 32).toString('hex') + bitmap.subarray(bitmap.length - 32).toString('hex')
            : bitmap.toString('hex')
          const fp = 'IMG_' + size.width + 'x' + size.height + '_' + bitmap.length + '_' + sample
          if (fp !== fingerprint.get()) {
            fingerprint.set(fp)
            if (!priming) onImage(img.toDataURL())
          }
          // 图文混合时优先图；未变化的图不解码、不重复推送。
          return true
        }
      }

      // Electron 44+ 将 macOS 原生文件引用映射为标准 URI 列表。
      if (platform === 'darwin' && itemFor('text/uri-list')) {
        const blob = await itemFor('text/uri-list').getType('text/uri-list')
        if (!isCurrent()) return false
        const text = await blob.text()
        if (!isCurrent()) return false
        const uri = text.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'))
        let filePath = ''
        try { if (uri) filePath = fileURLToPath(uri, { windows: false }) } catch (e) { /* not a local macOS file reference */ }
        if (filePath) {
          const fp = 'FILE_' + filePath
          if (fp !== fingerprint.get()) {
            fingerprint.set(fp)
            if (!priming) onFile(filePath)
          }
          return true
        }
      }

      if (itemFor('text/plain')) {
        const blob = await itemFor('text/plain').getType('text/plain')
        if (!isCurrent()) return false
        const text = (await blob.text()).trim()
        if (!isCurrent()) return false
        if (!text) return true
        const fp = 'TXT_' + text
        if (fp !== fingerprint.get()) {
          fingerprint.set(fp)
          if (!priming) onText(text)
        }
      }
      return true
    } finally {
      busy = false
    }
  }

  function cancel() {
    generation++
    imageSeq = null
    lastFormatsKey = null
    ticksSinceImageRead = Infinity
    lastImageNonEmpty = false
  }

  return { tick, cancel }
}

module.exports = { createClipboardPoller, startChangeCounter, DARWIN_CHANGE_COUNT_SCRIPT, IMAGE_RECHECK_TICKS }
