// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 设了「打开密码」的 Word/Excel/PPT（office-tier1 O14）：宿主侧解密 / 重新加密。
// 引擎（LOWA 24.2 WASM）带密码也打不开这类文件（真机探针：docx/xlsx/pptx 正确密码一律拒收），
// 所以在宿主解开、把明文 OOXML 交给引擎；保存时用同一把文件密钥重新加密再上传——
// 绝不把明文写回用户的文件。只认 MS-OFFCRYPTO「Agile」加密（Office 2010 起、WPS 的默认写法）。
//
// 格式（MS-OFFCRYPTO 2.3.4.10–2.3.4.15）：CFB 复合文档里两条流——
//   EncryptionInfo   = 版本 4.4 + 保留字 0x40 + XML（keyData / dataIntegrity / 密码 keyEncryptor）
//   EncryptedPackage = 8 字节明文长度 + 按 4096 字节分段的 AES-CBC 密文（每段 IV = H(keyData 盐 + 段号)）
// 密码 → 迭代哈希 → 解开 encryptedKeyValue 得到文件密钥；重存时文件密钥与密码那一段原样保留，
// 只换 keyData 盐与完整性 HMAC，所以保存不需要密码、也不重做 10 万次哈希。密码本身不保存。

import CFB from 'cfb'

const SEGMENT = 4096
const BLOCK_VERIFIER_INPUT = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]
const BLOCK_VERIFIER_HASH = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]
const BLOCK_KEY_VALUE = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]
const BLOCK_HMAC_KEY = [0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6]
const BLOCK_HMAC_VALUE = [0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33]
const HASHES = { SHA1: 'SHA-1', 'SHA-1': 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' }

const subtle = () => globalThis.crypto.subtle

export class OfficeEncryptionError extends Error {
  constructor(code, message) { super(message || code); this.code = code }
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const le32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b }
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const tob64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }
const digest = async (alg, data) => new Uint8Array(await subtle().digest(alg, data))
// 截断或用 fill 补齐到 n 字节（规范 2.3.4.12：派生密钥补 0x36，IV 补 0x36）
const fit = (u8, n, fill = 0x36) => { if (u8.length >= n) return u8.slice(0, n); const o = new Uint8Array(n).fill(fill); o.set(u8); return o }
const padBlock = (u8, bs) => u8.length % bs ? concat(u8, new Uint8Array(bs - (u8.length % bs))) : u8

// WebCrypto 的 AES-CBC 只做 PKCS#7 填充；Agile 密文是无填充的整块。
// 解密：补一个「解出来正好是 16×0x10」的尾块再解，结果去掉填充恰好是原明文。
// 尾块 = AES_K(0x10… XOR 最后一块密文)，用 IV=最后一块密文加密 16×0x10 取第一块即得。
async function aesDecryptRaw(key, iv, data) {
  if (!data.length || data.length % 16) throw new OfficeEncryptionError('CORRUPT', 'ciphertext is not block aligned')
  const last = data.subarray(data.length - 16)
  const tail = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: last }, key, new Uint8Array(16).fill(16))).subarray(0, 16)
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, key, concat(data, tail)))
}
// 加密：输入已按块对齐，WebCrypto 多出来的那一整块填充直接丢掉。
async function aesEncryptRaw(key, iv, data) {
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, key, data))
  return out.subarray(0, data.length)
}
const aesKey = (raw, usages = ['encrypt', 'decrypt']) => subtle().importKey('raw', raw, 'AES-CBC', false, usages)

function attrs(xml, tag) {
  const m = xml.match(new RegExp('<(?:[A-Za-z0-9]+:)?' + tag + '\\b([^>]*)>'))
  if (!m) return null
  const out = {}
  for (const a of m[1].matchAll(/([A-Za-z:]+)="([^"]*)"/g)) out[a[1]] = a[2]
  return out
}

function parseInfo(stream) {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength)
  if (stream.length < 8 || view.getUint16(0, true) !== 4 || view.getUint16(2, true) !== 4) {
    throw new OfficeEncryptionError('UNSUPPORTED_ENCRYPTION', 'only Agile encryption (version 4.4) is supported')
  }
  const xml = new TextDecoder('utf-8').decode(stream.subarray(8))
  const keyData = attrs(xml, 'keyData')
  const enc = attrs(xml, 'encryptedKey') // p:encryptedKey（密码 keyEncryptor）
  if (!keyData || !enc || !attrs(xml, 'dataIntegrity')) throw new OfficeEncryptionError('UNSUPPORTED_ENCRYPTION', 'no password key encryptor')
  for (const p of [keyData, enc]) {
    if (p.cipherAlgorithm !== 'AES' || p.cipherChaining !== 'ChainingModeCBC' || !HASHES[p.hashAlgorithm]) {
      throw new OfficeEncryptionError('UNSUPPORTED_ENCRYPTION', 'unsupported cipher ' + p.cipherAlgorithm + '/' + p.cipherChaining + '/' + p.hashAlgorithm)
    }
  }
  const num = (p) => ({ keyBytes: Number(p.keyBits) / 8, blockSize: Number(p.blockSize), hashSize: Number(p.hashSize), hash: HASHES[p.hashAlgorithm], salt: b64(p.saltValue) })
  return { header: stream.slice(0, 8), xml, keyData: num(keyData), enc: { ...num(enc), spinCount: Number(enc.spinCount), verifierInput: b64(enc.encryptedVerifierHashInput), verifierHash: b64(enc.encryptedVerifierHashValue), keyValue: b64(enc.encryptedKeyValue) } }
}

function readContainer(bytes) {
  let cfb
  try { cfb = CFB.read(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { type: 'array' }) }
  catch (e) { throw new OfficeEncryptionError('CORRUPT', 'not a compound file: ' + (e && e.message)) }
  // 按完整路径精确匹配（CFB.find 的模糊匹配实测会把 EncryptedPackage 找成 EncryptionInfo）
  const get = (name) => {
    const i = cfb.FullPaths.findIndex((p) => p.replace(/^[^/]*\//, '') === name)
    const f = i >= 0 ? cfb.FileIndex[i] : null
    return f && f.type === 2 && f.content ? new Uint8Array(f.content) : null
  }
  const info = get('EncryptionInfo'), pkg = get('EncryptedPackage')
  if (!info || !pkg) throw new OfficeEncryptionError('UNSUPPORTED_ENCRYPTION', 'not an encrypted OOXML package')
  // 其余流（\x06DataSpaces/…）重存时原样带上
  const others = []
  cfb.FileIndex.forEach((f, i) => {
    if (f.type !== 2 || f.name === 'EncryptionInfo' || f.name === 'EncryptedPackage') return
    others.push([cfb.FullPaths[i].replace(/^[^/]*\//, ''), new Uint8Array(f.content || [])])
  })
  return { info, pkg, others }
}

const utf16le = (s) => {
  const u = new Uint8Array(s.length * 2)
  const dv = new DataView(u.buffer)
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true)
  return u
}

// 规范 2.3.4.11：H0 = H(盐 + 密码 UTF-16LE)，Hn = H(n 的 LE32 + Hn-1) 迭代 spinCount 次；
// 每个用途的密钥 = H(Hn + blockKey) 截断/补齐到 keyBits。
async function deriveKey(enc, password) {
  let h = await digest(enc.hash, concat(enc.salt, utf16le(String(password))))
  const it = new Uint8Array(4 + h.length)
  const dv = new DataView(it.buffer)
  for (let i = 0; i < enc.spinCount; i++) { dv.setUint32(0, i, true); it.set(h, 4); h = await digest(enc.hash, it) }
  return (block) => digest(enc.hash, concat(h, new Uint8Array(block))).then((d) => fit(d, enc.keyBytes))
}

async function decryptPackage(pkg, secret, keyData) {
  if (pkg.length < 8) throw new OfficeEncryptionError('CORRUPT', 'package too short')
  const size = Number(new DataView(pkg.buffer, pkg.byteOffset, 8).getBigUint64(0, true))
  const body = pkg.subarray(8)
  if (size > body.length) throw new OfficeEncryptionError('CORRUPT', 'package size mismatch')
  const out = new Uint8Array(Math.ceil(size / SEGMENT) * SEGMENT)
  for (let seg = 0, off = 0; off < size; seg++, off += SEGMENT) {
    const iv = fit(await digest(keyData.hash, concat(keyData.salt, le32(seg))), keyData.blockSize)
    const chunk = body.subarray(off, Math.min(off + SEGMENT, body.length))
    out.set(await aesDecryptRaw(secret, iv, chunk.subarray(0, chunk.length - (chunk.length % 16))), off)
  }
  return out.slice(0, size)
}

// 明文 OOXML 必须是 zip（PK\x03\x04）：用会话密钥重开时，这一条就能识别「密钥不对」
const isZip = (u8) => u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 0x03 && u8[3] === 0x04

/**
 * 用密码解开。返回 { plain, session }；session 只在内存里，供重存与同一文件的重载使用。
 * 密码错 → OfficeEncryptionError('WRONG_PASSWORD')；非 Agile → 'UNSUPPORTED_ENCRYPTION'。
 */
export async function decryptOoxml(bytes, password) {
  const { info, pkg, others } = readContainer(bytes)
  const parsed = parseInfo(info)
  const { enc, keyData } = parsed
  const keyFor = await deriveKey(enc, password)
  const iv = fit(enc.salt, enc.blockSize)
  const dec = async (block, data) => aesDecryptRaw(await aesKey(await keyFor(block)), iv, data)
  const input = (await dec(BLOCK_VERIFIER_INPUT, enc.verifierInput)).subarray(0, enc.salt.length)
  const expected = (await dec(BLOCK_VERIFIER_HASH, enc.verifierHash)).subarray(0, enc.hashSize)
  const actual = await digest(enc.hash, input)
  if (actual.length !== expected.length || actual.some((b, i) => b !== expected[i])) throw new OfficeEncryptionError('WRONG_PASSWORD', 'wrong password')
  const secretRaw = (await dec(BLOCK_KEY_VALUE, enc.keyValue)).slice(0, keyData.keyBytes)
  const session = { secret: await aesKey(secretRaw), secretRaw, parsed, others }
  const plain = await decryptPackage(pkg, session.secret, keyData)
  if (!isZip(plain)) throw new OfficeEncryptionError('CORRUPT', 'decrypted package is not a zip')
  return { plain, session }
}

/** 同一文件重载（保存后、引擎重启）：用已解开的文件密钥直接解；密钥对不上（文件在别处换过密码）返回 null。 */
export async function decryptWithSession(bytes, session) {
  try {
    const { info, pkg } = readContainer(bytes)
    const keyData = parseInfo(info).keyData
    const plain = await decryptPackage(pkg, session.secret, keyData)
    return isZip(plain) ? plain : null
  } catch (e) { return null }
}

/** 把引擎导出的明文 OOXML 重新加密成与原文件同一密码、同一文件密钥的 Agile 加密包。 */
export async function encryptOoxml(plain, session) {
  if (!isZip(plain)) throw new OfficeEncryptionError('CORRUPT', 'export is not a zip')
  const { parsed, secret, others } = session
  const kd = parsed.keyData
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(kd.salt.length))
  const keyData = { ...kd, salt }
  const sizeHdr = new Uint8Array(8)
  new DataView(sizeHdr.buffer).setBigUint64(0, BigInt(plain.length), true)
  const parts = [sizeHdr]
  for (let seg = 0, off = 0; off < plain.length; seg++, off += SEGMENT) {
    const iv = fit(await digest(kd.hash, concat(salt, le32(seg))), kd.blockSize)
    parts.push(await aesEncryptRaw(secret, iv, padBlock(plain.subarray(off, off + SEGMENT), kd.blockSize)))
  }
  const pkg = concat(...parts)
  // 完整性：随机 HMAC 密钥（hashSize 字节）对整条 EncryptedPackage 流做 HMAC，二者都用文件密钥加密
  const hmacKey = globalThis.crypto.getRandomValues(new Uint8Array(kd.hashSize))
  const hk = await subtle().importKey('raw', hmacKey, { name: 'HMAC', hash: kd.hash }, false, ['sign'])
  const hmac = new Uint8Array(await subtle().sign('HMAC', hk, pkg))
  const ivFor = async (block) => fit(await digest(kd.hash, concat(salt, new Uint8Array(block))), kd.blockSize)
  const encHmacKey = await aesEncryptRaw(secret, await ivFor(BLOCK_HMAC_KEY), padBlock(hmacKey, kd.blockSize))
  const encHmacValue = await aesEncryptRaw(secret, await ivFor(BLOCK_HMAC_VALUE), padBlock(hmac, kd.blockSize))
  const xml = parsed.xml
    .replace(/(<(?:[A-Za-z0-9]+:)?keyData\b[^>]*?\bsaltValue=")[^"]*(")/, '$1' + tob64(salt) + '$2')
    .replace(/(<(?:[A-Za-z0-9]+:)?dataIntegrity\b[^>]*?\bencryptedHmacKey=")[^"]*(")/, '$1' + tob64(encHmacKey) + '$2')
    .replace(/(<(?:[A-Za-z0-9]+:)?dataIntegrity\b[^>]*?\bencryptedHmacValue=")[^"]*(")/, '$1' + tob64(encHmacValue) + '$2')
  const info = concat(parsed.header, new TextEncoder().encode(xml))
  const cfb = CFB.utils.cfb_new()
  for (const [path, content] of others) CFB.utils.cfb_add(cfb, path, content)
  CFB.utils.cfb_add(cfb, 'EncryptionInfo', info)
  CFB.utils.cfb_add(cfb, 'EncryptedPackage', pkg)
  const out = CFB.write(cfb, { type: 'array', fileType: 'cfb' })
  return out instanceof Uint8Array ? new Uint8Array(out.buffer, out.byteOffset, out.byteLength) : new Uint8Array(out)
}
