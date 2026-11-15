// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 三方合并存盘前：重建修订改回原日期、存出的文件里不许有合并自己的修订（台账 B13）
import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { restoreRecreatedRedlineDates, mergeMarkedAuthors } from '../../src/services/mergeRedlineDates.js'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
async function docx(body) {
  const z = new JSZip()
  z.file('word/document.xml', `<w:document ${W}><w:body>${body}</w:body></w:document>`)
  return z.generateAsync({ type: 'uint8array' })
}
const ins = (a, d, t) => `<w:ins w:id="1" w:author="${a}" w:date="${d}"><w:r><w:t>${t}</w:t></w:r></w:ins>`
const del = (a, d, t) => `<w:del w:id="2" w:author="${a}" w:date="${d}"><w:r><w:delText>${t}</w:delText></w:r></w:del>`
const dates = async (bytes) => [...(await (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string')).matchAll(/w:date="([^"]*)"/g)].map((m) => m[1])
const NOW = '2026-11-15T10:00:00Z'

test('同一位律师在两段里都改成「5」、时间不同：按文档顺序对回各自的原日期（真机实测曾对错）', async () => {
  const bytes = await docx(`<w:p><w:r><w:t>第二条 1</w:t></w:r>${del('甲', NOW, '2')}${ins('甲', NOW, '5')}</w:p><w:p><w:r><w:t>第三条 </w:t></w:r>${del('甲', NOW, '10')}${ins('甲', NOW, '5')}</w:p>`)
  const recreated = [
    // 故意打乱给：第三条（para 3）的在前
    { type: 'del', author: '甲', text: '10', date: '2026-11-15T09:23:29Z', para: 3 },
    { type: 'ins', author: '甲', text: '5', date: '2026-11-15T09:23:29Z', para: 3 },
    { type: 'del', author: '甲', text: '2', date: '2026-11-15T09:23:24Z', para: 2 },
    { type: 'ins', author: '甲', text: '5', date: '2026-11-15T09:23:24Z', para: 2 },
  ]
  const out = await restoreRecreatedRedlineDates(bytes, { recreated, freshSince: '2026-11-15T09:59:00Z' })
  assert.equal(out.restored, 4)
  assert.deepEqual(await dates(out.bytes), ['2026-11-15T09:23:24Z', '2026-11-15T09:23:24Z', '2026-11-15T09:23:29Z', '2026-11-15T09:23:29Z'])
})

test('引擎把一条插入拆成几段 w:ins：几段都拿到同一条的原日期；原有的修订（早于 freshSince）不碰', async () => {
  const bytes = await docx(`<w:p>${ins('AI', '2026-11-03T08:00:00Z', '旧')}${ins('乙', NOW, '付款')}${ins('乙', NOW, '完成日')}</w:p>`)
  const out = await restoreRecreatedRedlineDates(bytes, { recreated: [{ type: 'ins', author: '乙', text: '付款完成日', date: '2026-11-02T10:00:00Z', para: 0 }], freshSince: '2026-11-15T09:59:00Z' })
  assert.deepEqual(await dates(out.bytes), ['2026-11-03T08:00:00Z', '2026-11-02T10:00:00Z', '2026-11-02T10:00:00Z'])
})

test('没有重建的修订就原样返回字节', async () => {
  const bytes = await docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>')
  const out = await restoreRecreatedRedlineDates(bytes, { recreated: [], freshSince: NOW })
  assert.equal(out.bytes, bytes)
})

test('存出的文件里有署名带 U+2060 的修订：报出来', async () => {
  assert.deepEqual(await mergeMarkedAuthors(await docx(`<w:p>${ins('乙\u2060', NOW, 'x')}</w:p>`)), ['乙\u2060'])
  assert.deepEqual(await mergeMarkedAuthors(await docx(`<w:p>${ins('乙', NOW, 'x')}</w:p>`)), [])
})

test('引擎把首尾相接的两条删除并成一条「30」：按原来的两条拆回去，各回原日期（真机实测）', async () => {
  const bytes = await docx(`<w:p><w:r><w:t>目标公司 </w:t></w:r>${ins('甲', NOW, '4')}${del('甲', NOW, '30')}<w:r><w:t>%</w:t></w:r></w:p>`)
  const recreated = [
    { type: 'ins', author: '甲', text: '4', date: '2026-11-15T09:39:04Z', para: 1 },
    { type: 'del', author: '甲', text: '3', date: '2026-11-15T09:39:04Z', para: 1 },
    { type: 'del', author: '甲', text: '0', date: '2026-11-15T09:35:02Z', para: 1 },
  ]
  const out = await restoreRecreatedRedlineDates(bytes, { recreated, freshSince: '2026-11-15T09:59:00Z' })
  const xml = await (await JSZip.loadAsync(out.bytes)).file('word/document.xml').async('string')
  const dels = [...xml.matchAll(/<w:del\b[^>]*w:date="([^"]*)"[^>]*>[\s\S]*?<w:delText>([^<]*)<\/w:delText>/g)].map((m) => [m[2], m[1]])
  assert.deepEqual(dels, [['3', '2026-11-15T09:39:04Z'], ['0', '2026-11-15T09:35:02Z']])
  const ids = [...xml.matchAll(/<w:(?:ins|del)\b[^>]*\sw:id="(\d+)"/g)].map((m) => m[1])
  assert.equal(new Set(ids).size, ids.length, 'revision ids stay unique: ' + ids)
})
