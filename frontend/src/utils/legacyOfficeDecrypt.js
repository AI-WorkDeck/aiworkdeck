// SPDX-FileCopyrightText: 2015 nolze (msoffcrypto-tool)
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later AND MIT
//
// 本文件移植自 msoffcrypto-tool 6.1.0（MIT），其许可全文如下：
//
// MIT License
//
// Copyright (c) 2015 nolze
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// 老 Office 二进制格式（.doc/.xls/.ppt）的打开密码：宿主侧解密。
// 移植自 msoffcrypto-tool 6.1.0 的 format/doc97.py、xls97.py、ppt97.py 与
// method/rc4.py、rc4_cryptoapi.py、xor_obfuscation.py——只做解密，不做加密。
// 引擎（LOWA WASM）带密码打不开 .xls/.ppt，所以这里解开后把明文复合文档交给引擎。
// 支持：doc/xls 的 Office 97 RC4（版本 1.1）、RC4 CryptoAPI（版本 2/3/4 . 2）；xls 的 XOR 混淆；
// ppt 的 RC4 CryptoAPI。doc 的 XOR 混淆、其他版本一律抛 UNSUPPORTED_ENCRYPTION。
// 输出与 msoffcrypto 逐字节一致（含其对加密标志位的清除方式），复合文档容器的布局可能不同。
//
// 错误：Error.code 为 WRONG_PASSWORD（校验位不符）/ UNSUPPORTED_ENCRYPTION / CORRUPT。

import CFB from 'cfb'

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const PPT_TOKEN_ENCRYPTED = 0xf3d1c4df
const PPT_TOKEN_PLAIN = 0xe391c05f
const REC_BOF = 0x0809
const REC_EOF = 0x000a
const REC_FILEPASS = 0x002f
const REC_BOUNDSHEET8 = 0x0085
// MS-XLS：这些记录不加密/不混淆（BOF、FilePass、UsrExcl、FileLock、InterfaceHdr、RRDInfo、RRDHead）
const XLS_PLAIN_RECORDS = new Set([0x0809, 0x002f, 0x0194, 0x0195, 0x00e1, 0x0196, 0x0138])

const XOR_PAD_ARRAY = [0xBB, 0xFF, 0xFF, 0xBA, 0xFF, 0xFF, 0xB9, 0x80, 0x00, 0xBE, 0x0F, 0x00, 0xBF, 0x0F, 0x00]
const XOR_INITIAL_CODE = [0xE1F0, 0x1D0F, 0xCC9C, 0x84C0, 0x110C, 0x0E10, 0xF1CE, 0x313E, 0x1872, 0xE139, 0xD40F, 0x84F9, 0x280C, 0xA96A, 0x4EC3]
const XOR_MATRIX = [0xAEFC, 0x4DD9, 0x9BB2, 0x2745, 0x4E8A, 0x9D14, 0x2A09, 0x7B61, 0xF6C2, 0xFDA5, 0xEB6B, 0xC6F7, 0x9DCF, 0x2BBF, 0x4563, 0x8AC6, 0x05AD, 0x0B5A, 0x16B4, 0x2D68, 0x5AD0, 0x0375, 0x06EA, 0x0DD4, 0x1BA8, 0x3750, 0x6EA0, 0xDD40, 0xD849, 0xA0B3, 0x5147, 0xA28E, 0x553D, 0xAA7A, 0x44D5, 0x6F45, 0xDE8A, 0xAD35, 0x4A4B, 0x9496, 0x390D, 0x721A, 0xEB23, 0xC667, 0x9CEF, 0x29FF, 0x53FE, 0xA7FC, 0x5FD9, 0x47D3, 0x8FA6, 0x0F6D, 0x1EDA, 0x3DB4, 0x7B68, 0xF6D0, 0xB861, 0x60E3, 0xC1C6, 0x93AD, 0x377B, 0x6EF6, 0xDDEC, 0x45A0, 0x8B40, 0x06A1, 0x0D42, 0x1A84, 0x3508, 0x6A10, 0xAA51, 0x4483, 0x8906, 0x022D, 0x045A, 0x08B4, 0x1168, 0x76B4, 0xED68, 0xCAF1, 0x85C3, 0x1BA7, 0x374E, 0x6E9C, 0x3730, 0x6E60, 0xDCC0, 0xA9A1, 0x4363, 0x86C6, 0x1DAD, 0x3331, 0x6662, 0xCCC4, 0x89A9, 0x0373, 0x06E6, 0x0DCC, 0x1021, 0x2042, 0x4084, 0x8108, 0x1231, 0x2462, 0x48C4]

function fail(code, message) {
  const e = new Error(message || code)
  e.code = code
  return e
}

// ───────────── 小工具 ─────────────

function toU8(bytes) {
  if (bytes instanceof Uint8Array) return bytes
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  throw fail('CORRUPT', 'not a byte array')
}

const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
// DataView 越界会抛 RangeError，由 decryptLegacyOffice 统一转成 CORRUPT
const u16 = (u8, off) => view(u8).getUint16(off, true)
const u32 = (u8, off) => view(u8).getUint32(off, true)
function setU32(u8, off, v) { view(u8).setUint32(off, v >>> 0, true) }
function le32(n) { const b = new Uint8Array(4); setU32(b, 0, n); return b }

// 与 Python 切片不同：越界直接报错，不静默截断
function take(u8, off, len) {
  if (off < 0 || len < 0 || off + len > u8.length) throw fail('CORRUPT', 'truncated data')
  return u8.subarray(off, off + len)
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function utf16le(str) {
  const out = new Uint8Array(str.length * 2)
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    out[2 * i] = c & 0xff
    out[2 * i + 1] = c >>> 8
  }
  return out
}

async function sha1(data) {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', data))
}

// ───────────── MD5（WebCrypto 没有） ─────────────

const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const MD5_K = new Uint32Array(64)
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)

export function md5(input) {
  const data = toU8(input)
  const n = data.length
  const padded = new Uint8Array(((n + 8) >> 6 << 6) + 64)
  padded.set(data)
  padded[n] = 0x80
  const dv = view(padded)
  dv.setUint32(padded.length - 8, (n << 3) >>> 0, true)
  dv.setUint32(padded.length - 4, Math.floor(n / 0x20000000), true)
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  const M = new Uint32Array(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + 4 * i, true)
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F, g
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15 }
      else { F = C ^ (B | ~D); g = (7 * i) & 15 }
      F = (F + A + MD5_K[i] + M[g]) >>> 0
      A = D; D = C; C = B
      const s = MD5_S[(i >> 4) * 4 + (i & 3)]
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0
  }
  const out = new Uint8Array(16)
  const ov = view(out)
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true)
  return out
}

// ───────────── RC4 ─────────────

export function rc4(key, data) {
  const S = new Uint8Array(256)
  for (let i = 0; i < 256; i++) S[i] = i
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 255
    const t = S[i]; S[i] = S[j]; S[j] = t
  }
  const out = new Uint8Array(data.length)
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255
    j = (j + S[i]) & 255
    const t = S[i]; S[i] = S[j]; S[j] = t
    out[n] = data[n] ^ S[(S[i] + S[j]) & 255]
  }
  return out
}

// 每 blocksize 字节换一次密钥（块号从 startBlock 起），最后一块可以不满。移植自 DocumentRC4*.decrypt
async function rc4Blocks(data, keyForBlock, blocksize, startBlock = 0) {
  const out = new Uint8Array(data.length)
  for (let off = 0, block = startBlock; off < data.length; off += blocksize, block++) {
    const key = await keyForBlock(block)
    out.set(rc4(key, data.subarray(off, off + blocksize)), off)
  }
  return out
}

// Office 97/2000 RC4（MS-OFFCRYPTO 2.3.6.2）：MD5 派生
function rc4Key97(password) {
  return (salt) => {
    const h0 = md5(utf16le(password))
    const trunc = h0.subarray(0, 5)
    const piece = concat(trunc, salt)
    const h1 = md5(concat(...Array.from({ length: 16 }, () => piece)))
    const t1 = h1.subarray(0, 5)
    return (block) => md5(concat(t1, le32(block)))
  }
}

// RC4 CryptoAPI（MS-OFFCRYPTO 2.3.5.2）：SHA-1 派生
function rc4KeyCryptoApi(password, salt, keySize) {
  const h0Promise = sha1(concat(salt, utf16le(password)))
  return async (block) => {
    const hfinal = await sha1(concat(await h0Promise, le32(block)))
    return keySize === 40 ? concat(hfinal.subarray(0, 5), new Uint8Array(11)) : hfinal.slice(0, keySize / 8)
  }
}

// ───────────── 加密头解析 ─────────────

// 版本 1.1 的 RC4：salt(16) + 加密校验值(16) + 加密校验哈希(16)
function parseRc4Header(buf, pos) {
  return {
    salt: take(buf, pos, 16),
    encVerifier: take(buf, pos + 16, 16),
    encVerifierHash: take(buf, pos + 32, 16),
  }
}

// RC4 CryptoAPI：flags(4) + headerSize(4) + EncryptionHeader + EncryptionVerifier
function parseCryptoApiHeader(buf, pos) {
  const headerSize = u32(buf, pos + 4)
  const header = take(buf, pos + 8, headerSize)
  const algId = u32(header, 8)
  let keySize = u32(header, 16)
  if (keySize === 0) keySize = 40
  if ((algId !== 0 && algId !== 0x6801) || keySize < 40 || keySize > 128 || keySize % 8) {
    throw fail('UNSUPPORTED_ENCRYPTION', `RC4 CryptoAPI algId=0x${algId.toString(16)} keySize=${keySize}`)
  }
  const v = pos + 8 + headerSize
  return {
    salt: take(buf, v + 4, 16),
    keySize,
    encVerifier: take(buf, v + 20, 16),
    encVerifierHash: take(buf, v + 40, 20),
  }
}

// 解析「版本(4) + 头」，返回方法与已校验的 keyForBlock；密码不对抛 WRONG_PASSWORD
async function openRc4Session(buf, pos, password) {
  const vMajor = u16(buf, pos)
  const vMinor = u16(buf, pos + 2)
  if (vMajor === 1 && vMinor === 1) {
    const info = parseRc4Header(buf, pos + 4)
    const keyFor = rc4Key97(password)(info.salt)
    const d = rc4(keyFor(0), concat(info.encVerifier, info.encVerifierHash))
    if (!bytesEqual(md5(d.subarray(0, 16)), d.subarray(16))) throw fail('WRONG_PASSWORD')
    return { method: 'rc4', keyFor }
  }
  if ([2, 3, 4].includes(vMajor) && vMinor === 2) {
    const info = parseCryptoApiHeader(buf, pos + 4)
    const keyFor = rc4KeyCryptoApi(password, info.salt, info.keySize)
    const d = rc4(await keyFor(0), concat(info.encVerifier, info.encVerifierHash))
    if (!bytesEqual(await sha1(d.subarray(0, 16)), d.subarray(16))) throw fail('WRONG_PASSWORD')
    return { method: 'rc4_cryptoapi', keyFor }
  }
  throw fail('UNSUPPORTED_ENCRYPTION', `encryption version ${vMajor}.${vMinor}`)
}

function methodOfVersion(buf, pos) {
  const vMajor = u16(buf, pos)
  const vMinor = u16(buf, pos + 2)
  if (vMajor === 1 && vMinor === 1) return 'rc4'
  if ([2, 3, 4].includes(vMajor) && vMinor === 2) return 'rc4_cryptoapi'
  return 'unknown'
}

// ───────────── 复合文档 ─────────────

function extOf(name) {
  const m = /\.([^./\\]+)$/.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

function readCfb(bytes) {
  const u8 = toU8(bytes)
  if (u8.length < 512 || CFB_MAGIC.some((b, i) => u8[i] !== b)) throw fail('CORRUPT', 'not a compound file')
  try {
    const cfb = CFB.read(u8, { type: 'array' })
    cfb.src = u8
    return cfb
  } catch (e) {
    throw fail('CORRUPT', `compound file unreadable: ${e && e.message}`)
  }
}

// 只按完整路径精确匹配（大小写不敏感，与 olefile 一致）；cfb 自带的 CFB.find 是模糊匹配，不能用
function findStream(cfb, name) {
  const want = (cfb.FullPaths[0] + name).toLowerCase()
  for (let i = 0; i < cfb.FullPaths.length; i++) {
    const entry = cfb.FileIndex[i]
    if (entry && entry.type === 2 && cfb.FullPaths[i].toLowerCase() === want) return entry
  }
  return null
}

function readStream(cfb, name) {
  const entry = findStream(cfb, name)
  if (!entry) return null
  const c = entry.content
  return c instanceof Uint8Array ? c : Uint8Array.from(c || [])
}

function mustStream(cfb, name) {
  const s = readStream(cfb, name)
  if (!s) throw fail('CORRUPT', `missing stream ${name}`)
  return s
}

// 原地改写：解密不改流长度，所以直接把新内容写回原文件里该流占用的扇区——容器其余部分（目录、CLSID、
// 其他流、尾部填充）逐字节不变。cfb 的 CFB.write 会往输出里塞一条 \u0001Sh33tJ5 标记流，所以不用它写。
function sectorChain(next, start, limit) {
  const chain = []
  for (let s = start; s < 0xfffffffa; s = next[s]) {
    if (s === undefined || chain.length > limit) throw fail('CORRUPT', 'bad sector chain')
    chain.push(s)
  }
  return chain
}

function putStream(cfb, name, data) {
  const entry = findStream(cfb, name)
  if (!entry || entry.size !== data.length) throw fail('CORRUPT', `cannot replace stream ${name}`)
  const src = cfb.src
  if (!cfb.out) cfb.out = new Uint8Array(src)
  const out = cfb.out
  const secShift = u16(src, 30)
  const miniShift = u16(src, 32)
  const secSize = 1 << secShift
  const secOff = (sid) => (sid + 1) << secShift
  const limit = src.length >> 6

  // FAT：头部 DIFAT 的 109 项 + DIFAT 扇区链
  const difat = []
  for (let i = 0; i < 109; i++) difat.push(u32(src, 76 + 4 * i))
  for (let d = u32(src, 68), n = 0; d < 0xfffffffa; n++) {
    if (n > limit) throw fail('CORRUPT', 'bad DIFAT chain')
    const base = secOff(d)
    for (let i = 0; i < secSize / 4 - 1; i++) difat.push(u32(src, base + 4 * i))
    d = u32(src, base + secSize - 4)
  }
  const fat = []
  for (const sid of difat) {
    if (sid >= 0xfffffffa) continue
    for (let i = 0; i < secSize / 4; i++) fat.push(u32(src, secOff(sid) + 4 * i))
  }

  if (data.length >= u32(src, 56)) {
    let pos = 0
    for (const sid of sectorChain(fat, entry.start, limit)) {
      if (pos >= data.length) break
      out.set(data.subarray(pos, pos + secSize), secOff(sid))
      pos += secSize
    }
    return
  }
  // 小流：在 mini stream（根项的扇区链）里，按 mini FAT 取小扇区
  const miniFat = []
  for (const sid of sectorChain(fat, u32(src, 60), limit)) for (let i = 0; i < secSize / 4; i++) miniFat.push(u32(src, secOff(sid) + 4 * i))
  const miniStream = sectorChain(fat, cfb.FileIndex[0].start, limit)
  const miniSize = 1 << miniShift
  let pos = 0
  for (const msid of sectorChain(miniFat, entry.start, limit)) {
    if (pos >= data.length) break
    const byteOff = msid << miniShift
    out.set(data.subarray(pos, pos + miniSize), secOff(miniStream[byteOff >> secShift]) + (byteOff & (secSize - 1)))
    pos += miniSize
  }
}

function writeCfb(cfb) {
  const out = cfb.out || new Uint8Array(cfb.src)
  // 4 版复合文档（4096 字节扇区，Mac 版 PowerPoint 会写）：引擎与桌面 LibreOffice 都打不开这种容器里的 .ppt
  // （同样的明文换成 3 版容器即可正常打开，用户真实样本实测）。解出的明文只交给引擎、不落盘，重打包成 3 版。
  if (u16(out, 26) === 4) {
    const repacked = CFB.write(CFB.read(out, { type: 'array' }), { type: 'array', fileType: 'cfb' })
    return repacked instanceof Uint8Array ? new Uint8Array(repacked.buffer, repacked.byteOffset, repacked.byteLength) : new Uint8Array(repacked)
  }
  return out
}

// ───────────── 检测 ─────────────

function docFlags(cfb) {
  const wd = readStream(cfb, 'WordDocument')
  if (!wd || wd.length < 0x44 || u16(wd, 0) !== 0xa5ec) return null
  const flags = u16(wd, 0x0a)
  return { wd, encrypted: !!(flags & 0x100), obfuscated: !!(flags & 0x8000), tableName: flags & 0x200 ? '1Table' : '0Table' }
}

// 在 Globals 子流里找 FilePass（到第一个 EOF 为止）；返回 { type, body } 或 null
function findFilePass(wb) {
  let pos = 0
  if (wb.length < 4 || (u16(wb, 0) & 0xff) !== 0x09) return null // BOF（BIFF2..8 的低字节都是 0x09）
  while (pos + 4 <= wb.length) {
    const id = u16(wb, pos)
    const size = u16(wb, pos + 2)
    if (pos + 4 + size > wb.length) return null
    if (id === REC_FILEPASS) return { pos, size, body: wb.subarray(pos + 4, pos + 4 + size) }
    if (id === REC_EOF) return null
    pos += 4 + size
  }
  return null
}

function xlsStreamName(cfb) {
  return findStream(cfb, 'Workbook') ? 'Workbook' : findStream(cfb, 'Book') ? 'Book' : null
}

function detectInCfb(cfb, ext) {
  if (ext === 'doc') {
    const f = docFlags(cfb)
    if (!f || !f.encrypted) return null
    if (f.obfuscated) return { format: 'doc', method: 'xor' }
    const table = readStream(cfb, f.tableName)
    return { format: 'doc', method: table && table.length >= 4 ? methodOfVersion(table, 0) : 'unknown' }
  }
  if (ext === 'xls') {
    const sname = xlsStreamName(cfb)
    const fp = sname && findFilePass(readStream(cfb, sname))
    if (!fp || fp.size < 2) return null
    const type = u16(fp.body, 0)
    if (type === 0) return { format: 'xls', method: 'xor' }
    if (type === 1) return { format: 'xls', method: fp.size >= 6 ? methodOfVersion(fp.body, 2) : 'unknown' }
    return null
  }
  if (ext === 'ppt') {
    const cu = readStream(cfb, 'Current User')
    if (!cu || cu.length < 20 || u16(cu, 2) !== 0x0ff6 || u32(cu, 12) !== PPT_TOKEN_ENCRYPTED) return null
    return { format: 'ppt', method: 'rc4_cryptoapi' }
  }
  return null
}

/** @returns {null | {format: 'doc'|'xls'|'ppt', method: 'rc4'|'rc4_cryptoapi'|'xor'|'unknown'}} 永不抛错 */
export function detectLegacyEncryption(bytes, name) {
  try {
    const ext = extOf(name)
    if (!['doc', 'xls', 'ppt'].includes(ext)) return null
    return detectInCfb(readCfb(bytes), ext)
  } catch {
    return null
  }
}

/**
 * 这是不是一份结构完整的老 Office 二进制文件（OLE 复合文档头 + 对应的主数据流）。
 * 用于引擎拒收（DOC_REJECTED）后区分「格式太旧/不受支持」与「文件已损坏」：
 * 复合文档读得开且主流在 = 格式没坏，只是引擎不收；读不开/缺主流 = 按损坏处理。永不抛错。
 * @returns {null | 'doc'|'xls'|'ppt'}
 */
export function detectLegacyFormat(bytes, name) {
  try {
    const ext = extOf(name)
    const streams = { doc: ['WordDocument'], xls: ['Workbook', 'Book'], ppt: ['PowerPoint Document'] }[ext]
    if (!streams) return null
    const cfb = readCfb(bytes)
    return streams.some((s) => findStream(cfb, s)) ? ext : null
  } catch {
    return null
  }
}

// ───────────── doc ─────────────

async function decryptDoc(cfb, password, det) {
  const f = docFlags(cfb)
  if (det.method === 'xor') throw fail('UNSUPPORTED_ENCRYPTION', 'Word XOR obfuscation')
  const table = mustStream(cfb, f.tableName)
  const session = await openRc4Session(table, 0, password)
  const blocks = (data) => rc4Blocks(data, session.keyFor, 0x200)

  // WordDocument：前 0x44 字节（FIB 头）本来就是明文，只清 fEncrypted / fObfuscation / IKey；其余按流偏移解密
  const FIB_LENGTH = 0x44
  const wdDec = await blocks(f.wd)
  const wd = new Uint8Array(f.wd.length)
  wd.set(f.wd.subarray(0, FIB_LENGTH))
  wd.set(wdDec.subarray(FIB_LENGTH), FIB_LENGTH)
  wd[0x0b] &= ~(0x01 | 0x80) // flags 高字节：bit8 fEncrypted、bit15 fObfuscation
  wd.fill(0, 0x0e, 0x12) // IKey
  putStream(cfb, 'WordDocument', wd)
  putStream(cfb, f.tableName, await blocks(table))
  const data = readStream(cfb, 'Data')
  if (data) putStream(cfb, 'Data', await blocks(data))
}

// ───────────── xls ─────────────

function rotr8(n, r) { return ((n >>> r) | (n << (8 - r))) & 0xff }
const xorRor = (a, b) => rotr8(a ^ b, 1)

// 移植自 DocumentXOR.verifypw
function xorVerify(chars, verificationBytes) {
  let verifier = 0
  for (const b of [chars.length, ...chars].reverse()) {
    const hi = verifier & 0x4000 ? 1 : 0
    verifier = (hi ^ ((verifier * 2) & 0x7fff)) ^ b
  }
  return (verifier ^ 0xce4b) === verificationBytes
}

function xorKeyMethod1(chars) {
  let key = XOR_INITIAL_CODE[chars.length - 1]
  let cur = 0x68
  for (let ch of [...chars].reverse()) {
    for (let i = 0; i < 7; i++) {
      if (ch & 0x40) key = (key ^ XOR_MATRIX[cur]) & 0xffff
      ch = (ch << 1) & 0xff
      cur--
    }
  }
  return key
}

function xorArrayMethod1(chars) {
  const key = xorKeyMethod1(chars)
  const hi = (key & 0xff00) >> 8
  const lo = key & 0x00ff
  const arr = new Array(16).fill(0)
  let index = chars.length
  if (index % 2 === 1) {
    arr[index] = xorRor(XOR_PAD_ARRAY[0], hi)
    index--
    arr[index] = xorRor(chars[chars.length - 1], lo)
  }
  while (index > 0) {
    index--
    arr[index] = xorRor(chars[index], hi)
    index--
    arr[index] = xorRor(chars[index], lo)
  }
  index = 15
  let pad = 15 - chars.length
  while (pad > 0) {
    arr[index] = xorRor(XOR_PAD_ARRAY[pad], hi)
    index--
    pad--
    arr[index] = xorRor(XOR_PAD_ARRAY[pad], lo)
    index--
    pad--
  }
  return arr
}

async function decryptXls(cfb, password) {
  const sname = xlsStreamName(cfb)
  if (sname !== 'Workbook') throw fail('UNSUPPORTED_ENCRYPTION', 'BIFF5 Book stream')
  const wb = mustStream(cfb, sname)
  const fp = findFilePass(wb)
  if (!fp || fp.size < 2) throw fail('CORRUPT', 'FilePass missing')
  const type = u16(fp.body, 0)

  let xorArr = null
  let rc4Out = null
  if (type === 0) {
    const chars = Array.from(password, (c) => c.codePointAt(0))
    // MS-OFFCRYPTO：XOR 密码最长 15 个字符
    if (chars.length < 1 || chars.length > 15 || !xorVerify(chars, u16(fp.body, 2 + 2))) throw fail('WRONG_PASSWORD')
    xorArr = xorArrayMethod1(chars)
  } else if (type === 1) {
    const session = await openRc4Session(fp.body, 2, password)
    rc4Out = await rc4Blocks(wb, session.keyFor, 1024)
  } else {
    throw fail('UNSUPPORTED_ENCRYPTION', `FilePass wEncryptionType=${type}`)
  }

  // kind：0 明文原样保留；1 要解密；2 要解密（BoundSheet8 的 lbPlyPos 之后）
  const n = wb.length
  const kind = new Uint8Array(n)
  const out = wb.slice()
  for (let pos = 0; pos + 4 <= n;) {
    const id = u16(wb, pos)
    const size = u16(wb, pos + 2)
    if (pos + 4 + size > n) throw fail('CORRUPT', 'truncated BIFF record')
    const body = pos + 4
    if (id === REC_FILEPASS) {
      out.fill(0, pos, pos + 2) // 记录号清成 0、内容清零，保留长度
      out.fill(0, body, body + size)
    } else if (id === REC_BOUNDSHEET8) {
      const keep = Math.min(4, size) // lbPlyPos 不加密
      kind.fill(2, body + keep, body + size)
    } else if (!XLS_PLAIN_RECORDS.has(id)) {
      kind.fill(1, body, body + size)
    }
    pos += 4 + size
  }

  if (rc4Out) {
    for (let i = 0; i < n; i++) if (kind[i]) out[i] = rc4Out[i]
  } else {
    // 移植自 DocumentXOR.decrypt：按连续的待解密段处理，起始下标 = 段起点 + 段长（BoundSheet8 再 +4）
    for (let i = 0; i < n;) {
      if (!kind[i]) { i++; continue }
      let count = 1
      while (i + count < n && kind[i + count]) count++
      let xi = (kind[i] === 2 ? i + count + 4 : i + count) % 16
      for (let k = 0; k < count; k++) {
        out[i + k] = rotr8(wb[i + k] ^ xorArr[xi], 5)
        xi = (xi + 1) % 16
      }
      i += count
    }
  }
  putStream(cfb, sname, out)
}

// ───────────── ppt ─────────────

async function decryptPpt(cfb, password) {
  const cu0 = mustStream(cfb, 'Current User')
  const pd0 = mustStream(cfb, 'PowerPoint Document')
  if (u16(cu0, 2) !== 0x0ff6) throw fail('CORRUPT', 'bad Current User')
  const editOff = u32(cu0, 16)

  // UserEditAtom：必须带 encryptSessionPersistIdRef（recLen 0x20）
  if (u16(pd0, editOff + 2) !== 0x0ff5 || u32(pd0, editOff + 4) !== 0x20) throw fail('CORRUPT', 'bad UserEditAtom')
  const pdirOff = u32(pd0, editOff + 20)
  const cryptId = u32(pd0, editOff + 36)

  // 持久对象目录（加密文件只有一次编辑）：persistId -> offset
  if (u16(pd0, pdirOff + 2) !== 0x1772) throw fail('CORRUPT', 'bad PersistDirectoryAtom')
  const pdirEnd = pdirOff + 8 + u32(pd0, pdirOff + 4)
  const dir = new Map()
  let cryptEntryPos = -1
  for (let p = pdirOff + 8; p < pdirEnd;) {
    const head = u32(pd0, p)
    const persistId = head & 0xfffff
    const cPersist = head >>> 20
    for (let i = 0; i < cPersist; i++) dir.set(persistId + i, u32(pd0, p + 4 + 4 * i))
    if (cryptId >= persistId && cryptId < persistId + cPersist) {
      // 只能去掉某个条目的最后一项
      if (cryptId !== persistId + cPersist - 1) throw fail('UNSUPPORTED_ENCRYPTION', 'CryptSession10Container not last in entry')
      cryptEntryPos = p
    }
    p += 4 + 4 * cPersist
  }
  const cryptOff = dir.get(cryptId)
  if (cryptOff === undefined || cryptEntryPos < 0) throw fail('CORRUPT', 'CryptSession10Container not in persist directory')

  // CryptSession10Container：RecordHeader(8) + 版本(4) + 头
  if ((pd0[cryptOff] & 0x0f) !== 0x0f || u16(pd0, cryptOff + 2) !== 0x2f14) throw fail('CORRUPT', 'bad CryptSession10Container')
  const cryptLen = u32(pd0, cryptOff + 4)
  const crypt = take(pd0, cryptOff + 8, cryptLen)
  const session = await openRc4Session(crypt, 0, password)
  if (session.method !== 'rc4_cryptoapi') throw fail('UNSUPPORTED_ENCRYPTION', 'PowerPoint needs RC4 CryptoAPI')

  const pd = pd0.slice()
  // UserEditAtom：recLen 0x20 -> 0x1c，encryptSessionPersistIdRef 清零
  setU32(pd, editOff + 4, 0x1c)
  pd.fill(0, editOff + 36, editOff + 40)
  // PersistDirectoryAtom：去掉 CryptSession10Container 那一项（只减计数，偏移列表保持原长度）
  setU32(pd, cryptEntryPos, (u32(pd0, cryptEntryPos) & 0xfffff) | (((u32(pd0, cryptEntryPos) >>> 20) - 1) << 20))

  // 每个持久对象单独加密：块号 = persistId，整个对象（含 8 字节记录头）一段 RC4；对象长度 = 到下一个对象的偏移
  const offsets = [...new Set([...dir.values(), editOff, pdirOff, pd0.length])].sort((a, b) => a - b)
  const seen = new Set()
  for (const [persistId, offset] of dir) {
    if (offset === cryptOff) continue
    const recType = u16(pd0, offset + 2)
    if (recType === 0x0ff5 || recType === 0x1772 || seen.has(offset)) continue // 这两种记录不加密
    seen.add(offset)
    const end = offsets.find((o) => o > offset)
    const encObj = take(pd0, offset, end - offset)
    pd.set(rc4(await session.keyFor(persistId), encObj), offset)
  }
  pd.fill(0, cryptOff, cryptOff + 8 + cryptLen) // 去掉加密容器，补零保持流长度

  // Pictures 流（图片）：每条图片记录按字段分段、每段都从块 0 重新起 RC4（同 Apache POI
  // HSLFSlideShowEncrypted.decryptPicture）。用户真实样本（17 MB TIFF）实测：这样解出的图片完整可读，
  // 按 512 字节换块的解法从第二块起即错乱。
  const pic0 = findStream(cfb, 'Pictures')
  if (pic0 && pic0.size > 0) putStream(cfb, 'Pictures', decryptPptPictures(new Uint8Array(pic0.content), await session.keyFor(0)))

  const cu = cu0.slice()
  setU32(cu, 12, PPT_TOKEN_PLAIN)
  putStream(cfb, 'Current User', cu)
  putStream(cfb, 'PowerPoint Document', pd)
}

// 有两份 rgbUid 的图片实例（EMF/WMF/PICT/JPEG/PNG/DIB/TIFF 带第二 UID 的变体），见 MS-ODRAW OfficeArtBlip*
const PIC_TWO_UIDS = new Set([0x217, 0x3d5, 0x46b, 0x543, 0x6e1, 0x6e3, 0x6e5, 0x7a9])
function decryptPptPictures(enc, key0) {
  const out = enc.slice()
  const seg = (off, len) => { out.set(rc4(key0, enc.subarray(off, off + len)), off) }
  let off = 0
  while (off + 8 <= out.length) {
    seg(off, 8)
    const inst = u16(out, off) >>> 4
    const recType = u16(out, off + 2)
    const end = off + 8 + u32(out, off + 4)
    // 只认图片记录（OfficeArtBlip 0xF018–0xF117）；FBSE（0xF007）等 POI 也未用真实样本核对过，不猜
    if (recType < 0xf018 || recType > 0xf117 || end > out.length) throw fail('UNSUPPORTED_ENCRYPTION', 'unrecognised picture record 0x' + recType.toString(16))
    let p = off + 8
    for (let i = PIC_TWO_UIDS.has(inst) ? 2 : 1; i > 0; i--) { seg(p, 16); p += 16 }
    const meta = recType === 0xf01a || recType === 0xf01b || recType === 0xf01c ? 34 : 1 // 图元文件头 / tag
    seg(p, meta); p += meta
    if (p > end) throw fail('CORRUPT', 'picture record too short')
    seg(p, end - p)
    off = end
  }
  if (off !== out.length) throw fail('CORRUPT', 'trailing bytes in Pictures stream')
  return out
}

// 仅供单元测试：图片记录的分段解法用合成数据核对（真实样本不入库）
export const __test = { decryptPptPictures }

// ───────────── 入口 ─────────────

/**
 * 解开 .doc/.xls/.ppt 的打开密码，返回完整的明文复合文档。
 * @throws Error，code 为 WRONG_PASSWORD / UNSUPPORTED_ENCRYPTION / CORRUPT
 */
export async function decryptLegacyOffice(bytes, name, password) {
  try {
    const ext = extOf(name)
    if (!['doc', 'xls', 'ppt'].includes(ext)) throw fail('UNSUPPORTED_ENCRYPTION', `unsupported file type .${ext}`)
    const cfb = readCfb(bytes)
    const det = detectInCfb(cfb, ext)
    if (!det) throw fail('CORRUPT', 'file is not an encrypted legacy Office document')
    if (det.method === 'unknown') throw fail('UNSUPPORTED_ENCRYPTION', 'unrecognised encryption version')
    const pw = String(password ?? '')
    if (ext === 'doc') await decryptDoc(cfb, pw, det)
    else if (ext === 'xls') await decryptXls(cfb, pw)
    else {
      await decryptPpt(cfb, pw)
    }
    return writeCfb(cfb)
  } catch (e) {
    if (e && e.code) throw e
    const err = fail('CORRUPT', `malformed file: ${e && e.message}`)
    err.cause = e
    throw err
  }
}
