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
// 一段 XML 里 w:t / w:delText 的字（只取元素里的文字，不靠剥标签）
const runText = (xml) => [...String(xml).matchAll(/<w:(t|delText)\b[^>]*>([^<]*)<\/w:\1>/g)].map((m) => decode(m[2])).join('')
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
  // 按文档顺序（段序 para，同段保持原顺序）逐条对：同一位律师在不同段、不同时间改的同样几个字
  // （比如两段都把某个数改成「5」）只能靠位置分清，不能靠文字找第一条
  const ordered = recreated
    .map((r, i) => ({ r, i }))
    .filter((o) => o.r && o.r.date && o.r.author)
    .sort((a, b) => (a.r.para ?? Infinity) - (b.r.para ?? Infinity) || a.i - b.i)
    .map((o) => ({ ...o.r, rest: String(o.r.text || '') }))
  const groups = new Map()
  for (const r of ordered) {
    const key = r.type + '\u0000' + r.author
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  if (!groups.size || !freshSince) return { bytes, restored: 0 }
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file('word/document.xml')
  if (!file) return { bytes, restored: 0 }
  const xml = splitCombined(await file.async('string'), groups, freshSince)
  let restored = 0
  const out = xml.replace(/<w:(ins|del)\b([^>]*?)(\/?)>/g, (whole, kind, attrs, selfClose, offset) => {
    const author = attr(attrs, 'w:author')
    const date = attr(attrs, 'w:date')
    if (author == null || !date || date < freshSince) return whole
    const queue = groups.get(kind + '\u0000' + author)
    if (!queue || !queue.length) return whole
    const inPPr = xml.lastIndexOf('<w:pPr', offset) > xml.lastIndexOf('</w:pPr>', offset)
    let pick
    if (selfClose || inPPr) {
      // 段落标记上的修订（没有字）：标记删除各算一条；新增整段的标记排在它那段文字前面，日期跟那一条走
      const head = queue[0]
      pick = head.date
      if (head.mark) queue.shift()
    } else {
      const close = xml.indexOf('</w:' + kind + '>', offset)
      const inner = close > 0 ? runText(xml.slice(offset, close)) : ''
      // 先认排在最前的那一条；对不上（引擎把字拆合得不一样）再在同组里找，都不行就仍给最前那条的日期
      let k = queue[0].rest.startsWith(inner) ? 0 : queue.findIndex((r) => r.rest.startsWith(inner))
      if (k < 0) k = 0
      const hit = queue[k]
      pick = hit.date
      hit.rest = hit.rest.startsWith(inner) ? hit.rest.slice(inner.length) : ''
      if (!hit.rest) queue.splice(k, 1)
    }
    restored++
    return '<w:' + kind + attrs.replace(/\sw:date="[^"]*"/, ' w:date="' + pick + '"') + selfClose + '>'
  })
  if (!restored) return { bytes, restored: 0 }
  zip.file('word/document.xml', out)
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), restored }
}

// 引擎把同一位律师「首尾相接、几秒内新建」的几条修订并成一条（LO 的 CanCombine）：重建时原本日期
// 不同的两条（如先删的「0」与后删的「3」）就成了一条「30」。只有一个文字片段的这种修订，若它的字
// 恰好是同组里连续几条重建修订的字拼起来、且日期不止一个，就按原来的几条拆回去，再逐条对日期。
function splitCombined(xml, groups, freshSince) {
  const used = new Set()
  // 拆出来的每一段要有自己的 w:id（修订 id 在文档里须唯一）
  let nextId = Math.max(0, ...[...xml.matchAll(/\sw:id="(\d+)"/g)].map((m) => Number(m[1]))) + 1
  return xml.replace(/<w:(ins|del)\b([^>]*?)>(<w:r>(<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)?<w:(t|delText)\b([^>]*)>([^<]*)<\/w:\5><\/w:r>)<\/w:\1>/g,
    (whole, kind, attrs, run, rPr, tag, tAttrs, raw) => {
      const author = attr(attrs, 'w:author'), date = attr(attrs, 'w:date')
      if (author == null || !date || date < freshSince) return whole
      const list = groups.get(kind + '\u0000' + author) || []
      const text = decode(raw)
      for (let i = 0; i < list.length; i++) {
        if (used.has(list[i])) continue
        let acc = '', j = i
        while (j < list.length && acc.length < text.length) { acc += list[j].text || ''; j++ }
        const seq = list.slice(i, j)
        if (acc !== text || seq.length < 2 || new Set(seq.map((r) => r.date)).size < 2) continue
        seq.forEach((r) => used.add(r))
        const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        return seq.map((r, n) => '<w:' + kind + (n ? attrs.replace(/\sw:id="\d+"/, ' w:id="' + (nextId++) + '"') : attrs) + '><w:r>' + (rPr || '') + '<w:' + tag + tAttrs + '>' + esc(r.text) + '</w:' + tag + '></w:r></w:' + kind + '>').join('')
      }
      return whole
    })
}
