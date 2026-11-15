// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 三方合并存盘前的最后一道（台账 B13）：
// ① 存出的 docx 里不许留下任何合并自己的修订（署名末尾带 U+2060，见 office_thread.js 的
//    MERGE_MECH_MARK）——留下了就是这次合并没收干净，按失败处理，绝不让律师在 Word 里看到；
// ② 合并按原作者重建的待处理修订，引擎只能盖上「现在」的日期（修订日期只读），这里按原日期改回。
//    只改这次合并新建的（w:date 不早于 freshSince，且作者、类型在重建清单里的），原有修订不碰。
import JSZip from 'jszip'
import { MERGE_MECH_MARK } from '../utils/mergeRevisionView.js'

export { MERGE_MECH_MARK }

const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const attr = (tag, name) => { const m = tag.match(new RegExp('\\s' + name + '="([^"]*)"')); return m ? decode(m[1]) : null }

/** 存出的字节里还有没有合并自己的修订：返回带标记的作者名清单（空 = 干净）。 */
export async function mergeMarkedAuthors(bytes) {
  const zip = await JSZip.loadAsync(bytes)
  const found = new Set()
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/.*\.xml$/.test(name)) continue
    const xml = await zip.file(name).async('string')
    for (const m of xml.matchAll(/w:author="([^"]*)"/g)) {
      const a = decode(m[1])
      if (a.endsWith(MERGE_MECH_MARK)) found.add(a)
    }
  }
  return [...found]
}

/**
 * 把这次合并重建的待处理修订的日期改回原日期。
 * @param {Uint8Array|ArrayBuffer} bytes 引擎导出的 docx
 * @param {{recreated?: Array<{type:'ins'|'del', author:string, text?:string, date:string}>, freshSince?: string}} info
 *        recreated 来自 build_merge_draft / merge_take_other；freshSince 是合并开始时引擎时钟的 w:date 写法。
 * @returns {Promise<{bytes: Uint8Array, restored: number}>}
 */
export async function restoreRecreatedRedlineDates(bytes, { recreated = [], freshSince = '' } = {}) {
  const groups = new Map()
  for (const r of recreated) {
    if (!r || !r.date || !r.author) continue
    const key = r.type + '\u0000' + r.author
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  if (!groups.size || !freshSince) return { bytes, restored: 0 }
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return { bytes, restored: 0 }
  const xml = await file.async('string')
  let restored = 0
  const out = xml.replace(/<w:(ins|del)\b([^>]*?)(\/?)>/g, (whole, kind, attrs, selfClose, offset) => {
    const author = attr(attrs, 'w:author')
    const date = attr(attrs, 'w:date')
    if (author == null || !date || date < freshSince) return whole
    const list = groups.get(kind + '\u0000' + author)
    if (!list) return whole
    const dates = [...new Set(list.map((r) => r.date))]
    let pick = dates.length === 1 ? dates[0] : null
    if (!pick && !selfClose) {
      const close = xml.indexOf('</w:' + kind + '>', offset)
      const inner = close > 0 ? xml.slice(offset, close).replace(/<w:(t|delText)\b[^>]*>([^<]*)<\/w:\1>|<[^>]+>/g, (m, t, txt) => (t ? decode(txt) : '')) : ''
      const hit = inner && list.find((r) => r.text && (r.text === inner || r.text.includes(inner)))
      if (hit) pick = hit.date
    }
    if (!pick) pick = dates.slice().sort()[0]
    restored++
    return '<w:' + kind + attrs.replace(/\sw:date="[^"]*"/, ' w:date="' + pick + '"') + selfClose + '>'
  })
  if (!restored) return { bytes, restored: 0 }
  zip.file('word/document.xml', out)
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), restored }
}
