// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// model-matrix 的 outcomeCheck 辅助：从 xlsx/pptx 字节里读出单元格与幻灯片内容（只读、无第三方依赖，靠系统 unzip）。

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 先循环剥净标签再解实体（CodeQL js/incomplete-multi-character-sanitization：单次替换可能剩下 <script 片段）
const stripTags = s => { let prev; do { prev = s; s = s.replace(/<[^>]*>/g, '') } while (s !== prev); return s.replace(/</g, '') }
const unxml = s => stripTags(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&')

function withTmp(buf, fn) {
  const tmp = path.join(os.tmpdir(), `matrix-ox-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`)
  fs.writeFileSync(tmp, buf)
  try { return fn(tmp) } finally { fs.unlinkSync(tmp) }
}

export function zipParts(buf) {
  return withTmp(buf, f => execFileSync('unzip', ['-Z1', f], { maxBuffer: 64 << 20 }).toString('utf8').split('\n').filter(Boolean))
}

export function zipPart(buf, part) {
  return withTmp(buf, f => {
    try { return execFileSync('unzip', ['-p', f, part], { maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8') } catch { return '' }
  })
}

// 相对 base 目录解析 rels Target（xl/worksheets/sheet1.xml 之类）
const resolveTarget = (baseDir, target) => target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(baseDir, target))
const relsMap = (xml, baseDir) => Object.fromEntries([...xml.matchAll(/<Relationship\b[^>]*>/g)].map(m => {
  const id = /\bId="([^"]+)"/.exec(m[0])?.[1]; const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1]; const ty = /\bType="([^"]+)"/.exec(m[0])?.[1] || ''
  return [id, { target: t && resolveTarget(baseDir, t), type: ty }]
}))

// 列字母 ↔ 序号
export const colIndex = letters => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
export const colLetters = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s }

// 返回 { sheets: [名称...], sheet(name?) → { name, xml, cells: { A1: { v, f, s } }, rows: [[值...]] } }
export function readXlsx(buf) {
  const wb = zipPart(buf, 'xl/workbook.xml')
  const rels = relsMap(zipPart(buf, 'xl/_rels/workbook.xml.rels'), 'xl')
  const sst = [...zipPart(buf, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unxml((m[1].match(/<t(?: [^>]*)?>[^<]*<\/t>/g) || []).join('')))
  const sheetDefs = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => ({ name: unxml(/\bname="([^"]*)"/.exec(m[0])?.[1] || ''), rid: /\br:id="([^"]+)"/.exec(m[0])?.[1] }))
  const cache = {}
  const sheet = (name = sheetDefs[0]?.name) => {
    if (cache[name]) return cache[name]
    const def = sheetDefs.find(d => d.name === name)
    if (!def) return null
    const xml = zipPart(buf, rels[def.rid]?.target || '')
    const cells = {}
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1]; const body = m[2] || ''
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]; if (!ref) continue
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1]
      const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1]
      let v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      if (t === 's' && v != null) v = sst[Number(v)]
      else if (t === 'inlineStr') v = unxml((body.match(/<t(?: [^>]*)?>[^<]*<\/t>/g) || []).join(''))
      else if (v != null && t !== 'str' && t !== 'e' && t !== 'b' && v !== '' && !Number.isNaN(Number(v))) v = Number(v)
      else if (v != null) v = unxml(v)
      cells[ref] = { v: v ?? null, f: f != null ? unxml(f) : null, s: /\bs="(\d+)"/.exec(attrs)?.[1] ?? null }
    }
    let maxR = 0, maxC = 0
    for (const ref of Object.keys(cells)) { const [, c, r] = /^([A-Z]+)(\d+)$/.exec(ref); maxR = Math.max(maxR, +r); maxC = Math.max(maxC, colIndex(c)) }
    const rows = Array.from({ length: maxR }, (_, r) => Array.from({ length: maxC }, (_, c) => cells[colLetters(c + 1) + (r + 1)]?.v ?? null))
    return (cache[name] = { name, xml, cells, rows })
  }
  // 单元格样式：{ bold, fill: 'FFRRGGBB'|null }（按 cellXfs → fonts/fills 解析）
  let st = null
  const style = (sheetName, ref) => {
    if (!st) {
      const x = zipPart(buf, 'xl/styles.xml')
      const block = tag => new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(x)?.[1] || ''
      st = {
        xfs: [...block('cellXfs').matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => ({ font: +(/\bfontId="(\d+)"/.exec(m[0])?.[1] || 0), fill: +(/\bfillId="(\d+)"/.exec(m[0])?.[1] || 0) })),
        fonts: [...block('fonts').matchAll(/<font\b[^>]*?(?:\/>|>[\s\S]*?<\/font>)/g)].map(m => /<b\s*\/>|<b val="(1|true)"\s*\/>/.test(m[0])),
        fills: [...block('fills').matchAll(/<fill\b[^>]*?(?:\/>|>[\s\S]*?<\/fill>)/g)].map(m => /patternType="solid"/.test(m[0]) ? (/<fgColor\b[^>]*\brgb="([0-9A-Fa-f]+)"/.exec(m[0])?.[1] || 'solid') : null),
      }
    }
    const c = sheet(sheetName)?.cells[ref]; const xf = st.xfs[Number(c?.s ?? 0)] || { font: 0, fill: 0 }
    return { bold: !!st.fonts[xf.font], fill: st.fills[xf.fill] ?? null }
  }
  return { sheets: sheetDefs.map(d => d.name), sheet, style, parts: () => zipParts(buf), styles: () => zipPart(buf, 'xl/styles.xml') }
}

// 返回 [{ index(1 基), part, xml, paragraphs: [文本...], text, hasTable, hasChart, hasPicture, notes }]
export function readPptx(buf) {
  const pres = zipPart(buf, 'ppt/presentation.xml')
  const rels = relsMap(zipPart(buf, 'ppt/_rels/presentation.xml.rels'), 'ppt')
  const ids = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map(m => m[1])
  return ids.map((rid, i) => {
    const part = rels[rid]?.target
    const xml = zipPart(buf, part)
    const dir = path.posix.dirname(part)
    const srels = relsMap(zipPart(buf, `${dir}/_rels/${path.posix.basename(part)}.rels`), dir)
    const notesPart = Object.values(srels).find(r => /\/notesSlide$/.test(r.type))?.target
    const paras = xml => [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p [^>]*>([\s\S]*?)<\/a:p>/g)].map(m => unxml(((m[1] ?? m[2]).match(/<a:t>[^<]*<\/a:t>/g) || []).join(''))).filter(Boolean)
    const notesXml = notesPart ? zipPart(buf, notesPart) : ''
    // 备注页里第一个占位是幻灯片缩略图，正文在 type="body" 的占位里
    const notesBody = (notesXml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).filter(sp => /type="body"/.test(sp)).map(sp => paras(sp).join('\n')).join('\n')
    const paragraphs = paras(xml)
    return {
      index: i + 1, part, xml, paragraphs, text: paragraphs.join('\n'),
      hasTable: /<a:tbl>/.test(xml), hasChart: Object.values(srels).some(r => /\/chart$/.test(r.type)), hasPicture: /<p:pic>/.test(xml),
      notes: notesBody,
    }
  })
}
