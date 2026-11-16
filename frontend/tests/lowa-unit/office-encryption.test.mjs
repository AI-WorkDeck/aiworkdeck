// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// O14：设了打开密码的 Word/Excel/PPT 由宿主解密、保存时按同一密码重新加密（officeEncryption.js）。
// 夹具由独立实现 msoffcrypto-tool 加密（见 tests/lowa-e2e/fixtures/encrypted/README.md），密码 awd-0414。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import CFB from 'cfb'
import { createDecipheriv, createHash, createHmac } from 'node:crypto'
import { decryptOoxml, decryptWithSession, encryptOoxml } from '../../src/utils/officeEncryption.js'
import { isEncryptedOoxml } from '../../src/utils/editorLoadFailure.js'

const enc = (name) => new Uint8Array(readFileSync(new URL('../lowa-e2e/fixtures/encrypted/' + name, import.meta.url)))
const PLAIN = {
  'flexmark-table.docx': new URL('../lowa-e2e/fixtures/flexmark-table.docx', import.meta.url),
  'case-ledger.xlsx': new URL('../../../scripts/eval/fixtures/case-ledger.xlsx', import.meta.url),
  'case-report.pptx': new URL('../../../scripts/eval/fixtures/case-report.pptx', import.meta.url),
}
const plain = (name) => new Uint8Array(readFileSync(PLAIN[name]))
const PASSWORD = 'awd-0414'
const sessions = {}
const sessionFor = async (name) => sessions[name] || (sessions[name] = (await decryptOoxml(enc(name), PASSWORD)).session)

for (const name of Object.keys(PLAIN)) {
  test(name + '：正确密码解出与原文件逐字节相同；错密码报 WRONG_PASSWORD', async () => {
    assert.equal(isEncryptedOoxml(enc(name), name), true)
    await assert.rejects(decryptOoxml(enc(name), 'awd-0415'), (e) => e.code === 'WRONG_PASSWORD')
    const { plain: out, session } = await decryptOoxml(enc(name), PASSWORD)
    sessions[name] = session
    assert.deepEqual(out, plain(name))
  })

  test(name + '：重新加密后仍是加密包，同一会话/同一密码都能解回，且不含明文', async () => {
    const session = await sessionFor(name)
    const src = plain(name)
    const sealed = await encryptOoxml(src, session)
    assert.equal(isEncryptedOoxml(sealed, name), true, '保存出去的必须还是加密复合文档')
    assert.deepEqual(await decryptWithSession(sealed, session), src)
    assert.deepEqual((await decryptOoxml(sealed, PASSWORD)).plain, src, '用户在 Office/WPS 里用原密码能打开')
    await assert.rejects(decryptOoxml(sealed, 'nope'), (e) => e.code === 'WRONG_PASSWORD')
    // 明文 zip 里的文件名（[Content_Types].xml）不得出现在密文里
    assert.equal(Buffer.from(sealed).includes(Buffer.from('[Content_Types].xml')), false)
    // 每次保存换新盐：同一内容两次加密的密文不同
    assert.notDeepEqual(await encryptOoxml(src, session), sealed)
  })
}

test('原容器里的 DataSpaces 流原样带上；完整性 HMAC 随内容更新', async () => {
  const session = await sessionFor('case-ledger.xlsx')
  const sealed = await encryptOoxml(plain('case-ledger.xlsx'), session)
  const cfb = CFB.read(sealed, { type: 'array' })
  const paths = cfb.FullPaths.map((p) => p.replace(/^[^/]*\//, ''))
  for (const p of ['EncryptionInfo', 'EncryptedPackage', '\u0006DataSpaces/Version', '\u0006DataSpaces/DataSpaceMap',
    '\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace', '\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary']) {
    assert.ok(paths.includes(p), '缺少 ' + JSON.stringify(p))
  }
  const xml = (u8) => new TextDecoder().decode(u8.subarray(8))
  const info = (bytes) => { const c = CFB.read(bytes, { type: 'array' }); const i = c.FullPaths.findIndex((p) => p.endsWith('/EncryptionInfo')); return xml(new Uint8Array(c.FileIndex[i].content)) }
  const before = info(enc('case-ledger.xlsx')), after = info(sealed)
  const attr = (x, tag, a) => x.match(new RegExp('<' + tag + '\\b[^>]*\\b' + a + '="([^"]*)"'))[1]
  assert.equal(attr(after, 'p:encryptedKey', 'encryptedKeyValue'), attr(before, 'p:encryptedKey', 'encryptedKeyValue'), '文件密钥与密码那一段原样保留')
  assert.notEqual(attr(after, 'keyData', 'saltValue'), attr(before, 'keyData', 'saltValue'))
  assert.notEqual(attr(after, 'dataIntegrity', 'encryptedHmacValue'), attr(before, 'dataIntegrity', 'encryptedHmacValue'))
  // 用 node:crypto 独立核对完整性（MS-OFFCRYPTO 2.3.4.14）：Office 打开时会校验这段 HMAC
  const salt = Buffer.from(attr(after, 'keyData', 'saltValue'), 'base64')
  const iv = (block) => createHash('sha512').update(Buffer.concat([salt, Buffer.from(block, 'hex')])).digest().subarray(0, 16)
  const dec = (b64, block) => { const d = createDecipheriv('aes-256-cbc', Buffer.from(session.secretRaw), iv(block)); d.setAutoPadding(false); return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).subarray(0, 64) }
  const hmacKey = dec(attr(after, 'dataIntegrity', 'encryptedHmacKey'), '5fb2ad010cb9e1f6')
  const hmacValue = dec(attr(after, 'dataIntegrity', 'encryptedHmacValue'), 'a0677f02b22c8433')
  const c = CFB.read(sealed, { type: 'array' })
  const pkg = Buffer.from(c.FileIndex[c.FullPaths.findIndex((p) => p.endsWith('/EncryptedPackage'))].content)
  assert.deepEqual(hmacValue, createHmac('sha512', hmacKey).update(pkg).digest(), 'HMAC 必须覆盖整条 EncryptedPackage 流')
})

test('小于 4 KB 的文档（复合文档 mini stream）也能写出并读回', async () => {
  const session = await sessionFor('case-ledger.xlsx')
  const tiny = new Uint8Array(readFileSync(new URL('../../../scripts/eval/fixtures/contract.docx', import.meta.url)))
  assert.ok(tiny.length < 4096)
  const sealed = await encryptOoxml(tiny, session)
  assert.deepEqual((await decryptOoxml(sealed, PASSWORD)).plain, tiny)
})

test('会话密钥对不上（文件在别处换了密码）返回 null，由宿主重新要密码', async () => {
  const other = await sessionFor('case-report.pptx')
  assert.equal(await decryptWithSession(enc('case-ledger.xlsx'), other), null)
  assert.equal(await decryptWithSession(new Uint8Array(64), other), null)
})

test('非 Agile 加密（Standard 3.2 等）明确报 UNSUPPORTED_ENCRYPTION，不当成密码错', async () => {
  const c = CFB.read(enc('case-ledger.xlsx'), { type: 'array' })
  const i = c.FullPaths.findIndex((p) => p.endsWith('/EncryptionInfo'))
  const info = new Uint8Array(c.FileIndex[i].content)
  info[0] = 3; info[2] = 2 // version 3.2 = Standard Encryption
  c.FileIndex[i].content = info
  const standard = new Uint8Array(CFB.write(c, { type: 'array' }))
  await assert.rejects(decryptOoxml(standard, PASSWORD), (e) => e.code === 'UNSUPPORTED_ENCRYPTION')
})

test('导出结果不是 zip 时拒绝加密（不把意外内容写回用户文件）', async () => {
  const session = await sessionFor('case-ledger.xlsx')
  await assert.rejects(encryptOoxml(new Uint8Array([1, 2, 3, 4, 5, 6]), session), (e) => e.code === 'CORRUPT')
})
