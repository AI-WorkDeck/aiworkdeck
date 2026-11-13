// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 老二进制 Office（.doc/.xls/.ppt）打开密码解密（src/utils/legacyOfficeDecrypt.js）。
// 期望值：msoffcrypto-tool 6.1.0 对同一批夹具解密后，每条流的 SHA-256（一次性生成后写死在下面，CI 不需要 Python）。
// 夹具与来源见 tests/lowa-e2e/fixtures/encrypted/legacy/README.md。
// 运行：cd frontend && node --test tests/lowa-unit/legacy-office-decrypt.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import CFB from 'cfb'
import { decryptLegacyOffice, detectLegacyEncryption, md5, rc4, __test } from '../../src/utils/legacyOfficeDecrypt.js'

const FIX = new URL('../lowa-e2e/fixtures/encrypted/legacy/', import.meta.url)
const load = (name) => new Uint8Array(fs.readFileSync(new URL(name, FIX)))
const sha256 = (u8) => crypto.createHash('sha256').update(u8).digest('hex')

// 流路径（去掉 Root Entry/）-> msoffcrypto 解密输出里该流的 SHA-256
const MSOFFCRYPTO_DIGESTS = {
  "rc4cryptoapi_password.doc": {
    "\u0001CompObj": "f70fe384c672865fff4bb8ab60d73098bc751e8f2aa915b8aff2e2085648b428",
    "\u0005DocumentSummaryInformation": "026ea8b23978127c253846d5b3faa8e0a00f1dd4384261c84fc5a94558991cb1",
    "\u0005SummaryInformation": "f02d9d6cff72f33c508ecc73a54d617e88b80a61df64d265f4ce2ca929180ff2",
    "1Table": "118cceb61b87e4c36b219a4bfb2a60abac1c4bb4c63f8bcf153c900d01bda51d",
    "WordDocument": "371af53d2b61a6abd852cc70f9563923dd84579c06992440b2ad9a4ee82fcd93"
  },
  "rc4cryptoapi_password.xls": {
    "\u0005DocumentSummaryInformation": "7ba284d96e0009a005c318c93a8c23929b89e6c3291fa8b6e578fab6bd24bf1c",
    "\u0005SummaryInformation": "ee5339928c30a0ae98cd19954f280325353e029bab54f780965d27188dd70a92",
    "Workbook": "0685ff798ad938a41ba2996d4c64ebf761f1ac36b32fd8b6c6d21ab66e611f5c"
  },
  "rc4cryptoapi_password.ppt": {
    "\u0005DocumentSummaryInformation": "3e896545ca0f12221ba16769618a9632e8b4cbd27bdef670ca58b1eea4d43e98",
    "\u0005SummaryInformation": "1213d019736bf183e3946b32d7171203c0ab00b657b51bdfe20ac55cda594365",
    "Current User": "a643c635d15a7ae5cc22e043865c810ff5b611a9702fa006e258b1bbaf198f40",
    "PowerPoint Document": "9a47488a3595fdd17a5b508f2f230d60f1207a086e44eefdb1f10cf9b2a0c2d0"
  },
  "contract.doc": {
    "\u0001CompObj": "fadeb43f2f725c7d4b4d451fb0a33f220157ca22cd5eaea3737ef76f635426c7",
    "\u0001Ole": "c36c8a4b7dee703b9ce6e288032033b718feef01ca283cfaa4332a8334b2adf3",
    "\u0005DocumentSummaryInformation": "4bf70144f3e3f0b611e4aba0e93ceb37fd05a81a852137e1bf7b1f021a545c80",
    "\u0005SummaryInformation": "47cd783c91e1c0fc90d0b8784808dde8909a0a7c5bc39cec391c47f031b8e37e",
    "1Table": "e6395b63ab91a14f9f57b5592708bde61979aff65281bb42416d97c54b0c8843",
    "WordDocument": "9cf1e118688468e80004954ac5294f73edcfe300331b44403b91c89b97560fb4"
  },
  "case-ledger.xls": {
    "\u0001CompObj": "3b782f2ba4979fe212fc7bb0a985de42c31212a1802b70acf9d274116612476d",
    "\u0001Ole": "c36c8a4b7dee703b9ce6e288032033b718feef01ca283cfaa4332a8334b2adf3",
    "\u0005DocumentSummaryInformation": "2756028698ff817213fb23d42648d547702d9b2f7c1517e33a76d2047e0ca41d",
    "\u0005SummaryInformation": "00a96e658e76a138b20cf53616a16f68e90297b0818f233af265e43cc60ccce0",
    "Workbook": "1e2adbf47c2cbfe5da5fb6afb3eacc813ebd7bf190fcae3a4ae1a0a8a837a10e"
  },
  "xor_password_123456789012345.xls": {
    "\u0005DocumentSummaryInformation": "7b0607e40d49df9801c55983a4a78ff33ef82dd5a8d1fff05a13c404c6e82a33",
    "\u0005SummaryInformation": "a64e8648013c250c457b9ab268703c5d539e113688a68ac248b9b996b5720a21",
    "Workbook": "43ed9011b5bda898f5d94bf033bb0411789164c8eccc060c9b3c38ba0ffff094"
  }
}

const CASES = [
  { file: 'rc4cryptoapi_password.doc', password: 'Password1234_', format: 'doc', method: 'rc4_cryptoapi' },
  { file: 'rc4cryptoapi_password.xls', password: 'Password1234_', format: 'xls', method: 'rc4_cryptoapi' },
  { file: 'rc4cryptoapi_password.ppt', password: 'Password1234_', format: 'ppt', method: 'rc4_cryptoapi' },
  { file: 'xor_password_123456789012345.xls', password: '123456789012345', format: 'xls', method: 'xor' },
  { file: 'contract.doc', password: 'awd-0414', format: 'doc', method: 'rc4' },
  { file: 'case-ledger.xls', password: 'awd-0414', format: 'xls', method: 'rc4' },
]

function streamDigests(bytes) {
  const cfb = CFB.read(bytes, { type: 'array' })
  const out = {}
  cfb.FullPaths.forEach((p, i) => {
    if (cfb.FileIndex[i].type === 2) out[p.slice(cfb.FullPaths[0].length)] = sha256(Uint8Array.from(cfb.FileIndex[i].content))
  })
  return out
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (e) => e instanceof Error && e.code === code)
}

for (const c of CASES) {
  test(`${c.file}: 检测`, () => {
    assert.deepEqual(detectLegacyEncryption(load(c.file), c.file), { format: c.format, method: c.method })
    assert.deepEqual(detectLegacyEncryption(load(c.file), c.file.toUpperCase()), { format: c.format, method: c.method })
  })

  test(`${c.file}: 错误密码 -> WRONG_PASSWORD`, async () => {
    await rejectsWith(decryptLegacyOffice(load(c.file), c.file, c.password + 'x'), 'WRONG_PASSWORD')
    await rejectsWith(decryptLegacyOffice(load(c.file), c.file, ''), 'WRONG_PASSWORD')
  })

  test(`${c.file}: 正确密码 -> 每条流与 msoffcrypto 一致`, async () => {
    const src = load(c.file)
    const copy = src.slice()
    const out = await decryptLegacyOffice(src, c.file, c.password)
    assert.equal(out.constructor, Uint8Array)
    assert.deepEqual(src, copy, '不得改动入参')
    assert.deepEqual(streamDigests(out), MSOFFCRYPTO_DIGESTS[c.file])
    assert.equal(detectLegacyEncryption(out, c.file), null, '输出应已是明文文件')
  })
}

test('损坏 / 不支持的输入', async () => {
  const enc = load('rc4cryptoapi_password.xls')
  await rejectsWith(decryptLegacyOffice(enc.subarray(0, 100), 'a.xls', 'x'), 'CORRUPT')
  await rejectsWith(decryptLegacyOffice(new Uint8Array(2048), 'a.xls', 'x'), 'CORRUPT')
  await rejectsWith(decryptLegacyOffice(load('plain.ppt'), 'plain.ppt', 'x'), 'CORRUPT')
  await rejectsWith(decryptLegacyOffice(enc, 'a.docx', 'x'), 'UNSUPPORTED_ENCRYPTION')
  // 扩展名与内容不符：把 xls 当 doc / ppt 打开
  assert.equal(detectLegacyEncryption(enc, 'a.doc'), null)
  assert.equal(detectLegacyEncryption(enc, 'a.ppt'), null)
  // XOR 密码最长 15 个字符
  await rejectsWith(decryptLegacyOffice(load('xor_password_123456789012345.xls'), 'a.xls', '1234567890123456'), 'WRONG_PASSWORD')
})

test('检测：明文文件、非复合文档、随机字节 -> null，且不抛错', () => {
  assert.equal(detectLegacyEncryption(load('plain.ppt'), 'plain.ppt'), null)
  const xlsx = new Uint8Array(fs.readFileSync(new URL('../../../scripts/eval/fixtures/case-ledger.xlsx', import.meta.url)))
  for (const name of ['case-ledger.xlsx', 'a.doc', 'a.xls', 'a.ppt']) assert.equal(detectLegacyEncryption(xlsx, name), null)
  const rnd = crypto.randomBytes(4096)
  for (const name of ['a.doc', 'a.xls', 'a.ppt']) assert.equal(detectLegacyEncryption(new Uint8Array(rnd), name), null)
  // 有复合文档魔数但后面是垃圾
  const junk = new Uint8Array(4096)
  junk.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  for (const name of ['a.doc', 'a.xls', 'a.ppt']) assert.equal(detectLegacyEncryption(junk, name), null)
  assert.equal(detectLegacyEncryption(new Uint8Array(0), 'a.xls'), null)
  assert.equal(detectLegacyEncryption(load('rc4cryptoapi_password.xls'), 'a.txt'), null)
  assert.equal(detectLegacyEncryption(load('rc4cryptoapi_password.xls'), undefined), null)
})

test('MD5 与 node:crypto 一致', () => {
  const inputs = [
    new Uint8Array(0),
    Buffer.from('a'),
    Buffer.from('abc'),
    Buffer.from('The quick brown fox jumps over the lazy dog'),
    crypto.randomBytes(55), // 补位边界
    crypto.randomBytes(56),
    crypto.randomBytes(63),
    crypto.randomBytes(64),
    crypto.randomBytes(65),
    crypto.randomBytes(1000),
    crypto.randomBytes(100000),
  ]
  for (const b of inputs) {
    assert.equal(Buffer.from(md5(new Uint8Array(b))).toString('hex'), crypto.createHash('md5').update(b).digest('hex'), `len ${b.length}`)
  }
})

test('RC4 已知向量（常见向量：Key="Key", "Plaintext"）', () => {
  const enc = rc4(Buffer.from('Key'), Buffer.from('Plaintext'))
  assert.equal(Buffer.from(enc).toString('hex'), 'bbf316e8d940af0ad3')
})

// Pictures 流：每条图片记录按字段分段（记录头 / rgbUid ×1 或 2 / tag 或 34 字节图元文件头 / 图片数据），
// 每段都从块 0 重新起 RC4。用户真实样本（Mac PowerPoint，17 MB）上核对过；这里用合成记录锁住分段规则。
function pictureRecord(recType, inst, uidCount, metaLen, payload) {
  const body = new Uint8Array(16 * uidCount + metaLen + payload.length)
  for (let i = 0; i < 16 * uidCount + metaLen; i++) body[i] = (i * 7 + recType) & 0xff
  body.set(payload, 16 * uidCount + metaLen)
  const rec = new Uint8Array(8 + body.length)
  const dv = new DataView(rec.buffer)
  dv.setUint16(0, inst << 4, true); dv.setUint16(2, recType, true); dv.setUint32(4, body.length, true)
  rec.set(body, 8)
  return { rec, segments: [8, ...Array(uidCount).fill(16), metaLen, payload.length] }
}
test('加密 .ppt 的图片：按 POI 的分段规则逐条解开（PNG / 双 UID 的 JPEG / EMF）', () => {
  const key = new Uint8Array(16).map((_, i) => i * 13 + 1)
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...Array.from({ length: 3000 }, (_, i) => i & 0xff)])
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, ...Array.from({ length: 1500 }, (_, i) => (i * 3) & 0xff), 0xff, 0xd9])
  const records = [pictureRecord(0xf01e, 0x6e0, 1, 1, png), pictureRecord(0xf01d, 0x46b, 2, 1, jpeg), pictureRecord(0xf01a, 0x3d4, 1, 34, new Uint8Array(700).fill(9))]
  const plain = new Uint8Array(records.reduce((n, r) => n + r.rec.length, 0))
  const enc = new Uint8Array(plain.length)
  let off = 0
  for (const { rec, segments } of records) {
    plain.set(rec, off)
    let p = 0
    for (const len of segments) { enc.set(rc4(key, rec.subarray(p, p + len)), off + p); p += len }
    off += rec.length
  }
  assert.deepEqual(__test.decryptPptPictures(enc, key), plain)
  // 整条记录一口气 RC4（不分段重置）解出来是错的——锁住「每段重置」这一点
  const continuous = new Uint8Array(enc.length); off = 0
  for (const { rec } of records) { continuous.set(rc4(key, rec), off); off += rec.length }
  let wrong = null
  try { wrong = __test.decryptPptPictures(continuous, key) } catch (e) { wrong = null }
  assert.notDeepEqual(wrong, plain)
})

test('图片区里出现认不出的记录：明确报 UNSUPPORTED_ENCRYPTION，不猜', () => {
  const key = new Uint8Array(16).fill(3)
  const rec = new Uint8Array(8 + 4); new DataView(rec.buffer).setUint16(2, 0xf007, true); new DataView(rec.buffer).setUint32(4, 4, true)
  assert.throws(() => __test.decryptPptPictures(rc4(key, rec), key), (e) => e.code === 'UNSUPPORTED_ENCRYPTION')
})
