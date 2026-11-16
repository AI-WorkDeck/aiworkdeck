#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎（台账 B13）：三方合并不许把三份稿里原有的待处理修订静默接受掉。
//
// 产品里 AI 改稿默认带修订、律师多开着修订改，合并时三份稿（共同的上一版、主线、另一侧）里都有
// 待处理修订是常态。0.86.0 及以前：自动合并收尾「全部接受」、完成裁决「接受剩下的全部」——律师
// 要交给客户的修订痕迹被当成合并改动一起接受成正文；另一侧按 POI 取字重放，删掉的字原样写回正文；
// 共同的上一版里有 AI 待处理插入时合并比对稿直接打不开（「段数对不上：当前 6，按计划应为 5」）。
//
// A 自动合并（走真宿主代码 useDocumentMerge）：主线一处、另一侧一处改字 + 一处只删不加 + 新增一条，
//   全是待处理修订。存出的文件里每条修订的类型 / 作者 / 原日期 / 文字逐条核对；拒绝全部修订读回
//   共同的上一版，接受全部修订读回两边改动都在。
// B 同一段两边都带待处理修订（冲突）：「用你的」「用对方的」各一遍，选中的那一侧的修订原样留着。
// C 发版前回归的原样三份文件（共同的上一版里是 AI 待处理插入的一段，两边都把它删成修订再各写一句）：
//   合并比对稿要打得开，「用对方的」之后段落标记与 AI 那条插入、律师那条删除、新写的一句都在。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor, here } from './_boot.mjs'
import { useDocumentMerge } from '../../src/composables/useDocumentMerge.js'
import { restoreRecreatedRedlineDates, mergeMarkedAuthors } from '../../src/services/mergeRedlineDates.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-merge-pending-'))
execFileSync('python3', ['-I', path.join(here, 'fixtures/merge/gen-pending.py'), dir])
const read = (f) => new Uint8Array(fs.readFileSync(path.isAbsolute(f) ? f : path.join(dir, f)))
const RC = (f) => path.join(here, 'fixtures/merge/b13-rc086', f)

// ---- docx 读回：每条修订、接受全部 / 拒绝全部之后的正文段落（与 Word 的语义一致） ----
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
async function docXml(bytes) { return (await JSZip.loadAsync(bytes)).file('word/document.xml').async('string') }
function bodyParagraphs(xml) {
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('</w:body>'))
  // 只要正文顶层段落（表格单元里的段落不算，与引擎、后端同口径）
  const out = []
  let depth = 0, i = 0
  const re = /<w:tbl[ >]|<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g
  let m
  while ((m = re.exec(body))) {
    if (m[0].startsWith('<w:tbl')) depth++
    else if (m[0] === '</w:tbl>') depth--
    else if (!depth) out.push(m[0])
    i++
  }
  return out
}
function revisionsOf(xml) {
  const list = []
  const re = /<w:(ins|del)\b([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(xml))) {
    const a = (n) => { const x = m[2].match(new RegExp('\\s' + n + '="([^"]*)"')); return x ? decode(x[1]) : '' }
    let text = ''
    if (!m[3]) {
      const close = xml.indexOf('</w:' + m[1] + '>', m.index)
      text = [...xml.slice(m.index, close).matchAll(/<w:(t|delText)\b[^>]*>([^<]*)<\/w:\1>/g)].map((x) => decode(x[2])).join('')
    }
    // 段落标记上的修订写在 w:pPr/w:rPr 里（引擎导出时不一定自闭合）
    const inPPr = xml.lastIndexOf('<w:pPr', m.index) > xml.lastIndexOf('</w:pPr>', m.index)
    list.push({ type: m[1], author: a('w:author'), date: a('w:date'), text: inPPr ? '' : text, mark: inPPr })
  }
  return list
}
function views(xml) {
  const acc = [], rej = []
  let carryA = '', carryR = ''
  for (const p of bodyParagraphs(xml)) {
    const ppr = (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0]
    const markIns = /<w:rPr>[\s\S]*<w:ins\b/.test(ppr), markDel = /<w:rPr>[\s\S]*<w:del\b/.test(ppr)
    const content = p.replace(ppr, '')
    let a = '', r = ''
    const stack = []
    const re = /<w:(ins|del)\b[^>]*?\/>|<w:(ins|del)\b[^>]*>|<\/w:(ins|del)>|<w:(t|delText)\b[^>]*>([^<]*)<\/w:\4>/g
    let m
    while ((m = re.exec(content))) {
      if (m[2]) stack.push(m[2])
      else if (m[3]) stack.pop()
      else if (m[4]) {
        const txt = decode(m[5]), inIns = stack.includes('ins'), inDel = stack.includes('del') || m[4] === 'delText'
        if (!inDel) a += txt
        if (!inIns) r += txt
      }
    }
    if (markDel) carryA += a; else { acc.push(carryA + a); carryA = '' }
    if (markIns) carryR += r; else { rej.push(carryR + r); carryR = '' }
  }
  return { accepted: acc, rejected: rej }
}
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().normalize('NFC')
async function bodyTexts(bytes) { return bodyParagraphs(await docXml(bytes)).map((p) => [...p.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((x) => decode(x[1])).join('')) }

// 与后端 DocxUnitReader 同口径的单元（正文段落按 POI getText；表格单元格跟在表的位置）
async function unitsOf(bytes) {
  const xml = await docXml(bytes)
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('</w:body>'))
  const units = []
  let pi = 0, ti = 0
  // XWPFParagraph.getText 只取 w:t（删掉的字 w:delText 不算）——接受了待处理修订之后的文字
  const textOf = (frag) => [...frag.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((x) => decode(x[1])).join('')
  const re = /<w:tbl[ >][\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g
  let m
  while ((m = re.exec(body))) {
    if (m[0].startsWith('<w:tbl')) {
      const rows = m[0].match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []
      rows.forEach((row, r) => (row.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) || []).forEach((tc, c) => {
        units.push({ key: 't' + ti + '.' + r + '.' + c, text: (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(textOf).join('\n') })
      }))
      ti++
    } else units.push({ key: 'p' + pi++, text: textOf(m[0]) })
  }
  return units.map((u) => ({ key: u.key, text: u.text, norm: norm(u.text) }))
}
// 一处 1:1 改写的块（坐标 = 基线单元下标）
const modify = (baseUnits, key, text, conflict = false) => {
  const i = baseUnits.findIndex((u) => u.key === key)
  return { type: 'MODIFY', baseStart: i, baseEnd: i + 1, texts: [text], ids: [], conflict }
}

preflight()
const server = await startServer({})
const browser = await launchBrowser(await loadPuppeteer())
const results = []
try {
  const page = await openEditor(browser)
  // 把宿主的 run(action, payload) 接到页面里的真引擎；字节进出都转成普通数组
  const run = async (action, payload = {}) => {
    const p = {}
    for (const [k, v] of Object.entries(payload || {})) p[k] = v instanceof Uint8Array ? Array.from(v) : v
    const r = await page.evaluate(async (a, q) => {
      for (const k of ['baseBytes', 'mainBytes', 'otherBytes', 'bytes']) if (Array.isArray(q[k])) q[k] = new Uint8Array(q[k])
      const res = await window.__loExecutor.executeCommand(a, q)
      if (res && res.bytes) res.bytes = Array.from(res.bytes)
      return res
    }, action, p)
    if (r && Array.isArray(r.bytes)) r.bytes = new Uint8Array(r.bytes)
    return r
  }
  const baseU = await unitsOf(read('base.docx'))

  // ---------------- A：自动合并（真宿主代码） ----------------
  {
    const mainU = await unitsOf(read('main.docx')), otherU = await unitsOf(read('other.docx'))
    const plan = {
      mainChunks: [modify(baseU, 'p2', mainU[2].text)],
      otherChunks: [modify(baseU, 'p1', otherU[1].text), modify(baseU, 'p4', otherU[4].text),
        { type: 'INSERT', baseStart: 5, baseEnd: 5, texts: [otherU[5].text], ids: [], conflict: false }],
    }
    const written = []
    const deps = {
      projectId: 7, isDesktop: true, t: (k) => k, toast: () => {},
      getExecutorForHiddenInstance: async () => ({ run }), releaseHiddenInstance: () => {},
      fetchMergeInputs: async () => ({ baseBytes: read('base.docx'), mainBytes: read('main.docx'), otherBytes: read('other.docx'), analysis: { plan, baseUnits: baseU } }),
      buildMergeDraft: (r, inputs, { mainAuthor, otherAuthor, name }) => r('build_merge_draft', {
        baseBytes: inputs.baseBytes, mainBytes: inputs.mainBytes, otherBytes: inputs.otherBytes,
        mainAuthor, otherAuthor, plan: inputs.analysis.plan, baseUnits: inputs.analysis.baseUnits, name }),
      api: {
        postMergeResolveFile: async (pid, body) => { written.push(body); return { code: 0, data: { path: body.path, state: 'MERGED' } } },
        postMergeResolveStructured: async () => ({ code: 0, data: {} }),
        resolveAdopt: async () => ({ data: { affectedFileIds: [] } }),
        resolveCloudMerge: async () => ({ data: {} }), resolveSessionEnd: async () => ({ data: {} }),
      },
      reloadFiles: () => true, openOverview: () => {},
    }
    const conflict = {
      draftId: 3, conflictingPaths: ['合同.docx'], mergeBase: 'b', mainlineTip: 'm', draftTip: 'o',
      sides: { main: { authorName: '张律师' }, other: { authorName: '李律师' } },
      documentMerges: [{ path: '合同.docx', kind: 'DOCX', decision: 'AUTO', reason: 'CLEAN', mainChanges: 1, otherChanges: 3, overlapCount: 0, state: 'PENDING' }],
    }
    if (process.env.B13_DEBUG) { const inp = await deps.fetchMergeInputs(); const b = await deps.buildMergeDraft(run, inp, { mainAuthor: '张律师', otherAuthor: '李律师', name: 'x.docx' }); console.log('DEBUG build', JSON.stringify({ success: b.success, stage: b.stage, message: b.message })) }
    const merge = useDocumentMerge(deps)
    await merge.onConflictStatus(conflict, 'adopt')
    const row = merge.state.rows.find((r) => r.path === '合同.docx')
    assert.equal(written.length, 1, 'auto merge must write the merged file: ' + JSON.stringify(row))
    const bytes = new Uint8Array(written[0].bytes)
    const xml = await docXml(bytes)
    const revs = revisionsOf(xml)
    const v = views(xml)
    results.push({ case: 'A', revisions: revs.map((r) => [r.type, r.author, r.date, r.text, r.mark ? 'mark' : ''].join('|')), accepted: v.accepted })
    assert.deepEqual(await mergeMarkedAuthors(bytes), [], 'no merge-marked revision may be saved')
    const has = (type, author, date, text) => revs.some((r) => r.type === type && r.author === author && r.date === date && r.text === text)
    assert.ok(has('del', '甲律师', '2026-11-01T09:00:00Z', '2') && has('ins', '甲律师', '2026-11-01T09:00:00Z', '5'), 'main side pending change kept with author and date')
    assert.ok(has('del', '乙律师', '2026-11-02T11:30:00Z', '目标公司 '), 'other side pending deletion-only change kept, with its own date (same author, another time)')
    assert.ok(has('del', '乙律师', '2026-11-02T10:00:00Z', '交割日') && has('ins', '乙律师', '2026-11-02T10:00:00Z', '付款完成日'), 'other side pending change kept with author and original date')
    assert.ok(has('ins', '乙律师', '2026-11-02T10:00:00Z', '第四条之一 陈述与保证：双方保证所提供信息真实。'), 'other side pending new clause kept as a pending insertion')
    assert.ok(has('del', 'AI WorkDeck', '2026-11-03T08:00:00Z', '分两期'), 'the AI pending deletion inherited from the base is untouched')
    assert.ok(revs.every((r) => ['甲律师', '乙律师', 'AI WorkDeck'].includes(r.author)), 'no revision by anyone else: ' + JSON.stringify(revs))
    assert.deepEqual(v.rejected.map(norm), views(await docXml(read('base.docx'))).rejected.map(norm), 'rejecting every tracked change gives back the common base')
    assert.deepEqual(v.accepted.map(norm), [
      '股权转让协议（虚构示范）', '第一条 转让标的：甲方将其持有的30% 股权转让给乙方。', '第二条 转让价款：转让价款为人民币 1500 万元。',
      '第三条 付款安排：乙方应于协议生效后 10 个工作日内付清。', '第四条 过渡期：自签署日至付款完成日为过渡期。',
      '第四条之一 陈述与保证：双方保证所提供信息真实。', '第五条 争议解决：提交示范仲裁委员会仲裁。'].map(norm), 'accepting everything gives both sides\' changes')
  }

  // ---------------- B：同一段两边都带待处理修订 ----------------
  const manual = async ({ base, main, other, conflictKey, choose }) => {
    const bU = await unitsOf(read(base)), mU = await unitsOf(read(main)), oU = await unitsOf(read(other))
    const i = bU.findIndex((u) => u.key === conflictKey)
    const plan = { mainChunks: [modify(bU, conflictKey, mU[i].text, true)], otherChunks: [modify(bU, conflictKey, oU[i].text, true)] }
    const built = await run('build_merge_draft', { baseBytes: read(base), mainBytes: read(main), otherBytes: read(other),
      mainAuthor: '张律师', otherAuthor: '李律师', plan, baseUnits: bU, name: 'm.docx' })
    assert.equal(built && built.success, true, 'combined draft must open: ' + JSON.stringify(built && { stage: built.stage, message: built.message }))
    const side = (built.conflictSides || []).find((s) => s.key === conflictKey)
    assert.ok(side, 'the engine reports the other side of the conflict')
    let recreated = built.recreated || []
    if (choose === 'other') {
      const took = await run('merge_take_other', { paraKey: side.paraKey, side: side.side, author: '李律师' })
      assert.equal(took && took.success, true, 'keep the other side: ' + JSON.stringify(took))
      recreated = recreated.concat(took.recreated || [])
    }
    const acc = await run('resolve_merge_mechanics', { action: 'accept' })
    assert.equal(acc && acc.success, true, 'accept merge revisions only: ' + JSON.stringify(acc))
    const exported = await run('export_document', { name: 'm.docx' })
    const bytes = (await restoreRecreatedRedlineDates(exported.bytes, { recreated })).bytes
    assert.deepEqual(await mergeMarkedAuthors(bytes), [], 'no merge-marked revision may be saved')
    const xml = await docXml(bytes)
    return { revs: revisionsOf(xml), views: views(xml), bU }
  }
  for (const choose of ['main', 'other']) {
    const r = await manual({ base: 'base.docx', main: 'main-conflict.docx', other: 'other-conflict.docx', conflictKey: 'p3', choose })
    results.push({ case: 'B-' + choose, revisions: r.revs.map((x) => [x.type, x.author, x.date, x.text].join('|')), accepted: r.views.accepted[3] })
    const who = choose === 'main' ? ['甲律师', '2026-11-01T09:00:00Z', '15'] : ['乙律师', '2026-11-02T10:00:00Z', '5']
    assert.deepEqual(r.revs.map((x) => [x.type, x.author, x.date, x.text]).sort(), [['del', who[0], who[1], '10'], ['ins', who[0], who[1], who[2]]].sort(), choose + ': exactly that side\'s pending revisions remain')
    const baseRej = views(await docXml(read('base.docx'))).rejected.map(norm)
    baseRej[3] = norm('第三条 付款安排：乙方应于协议生效后 10 个工作日内付清。')   // 冲突段整段以选中的一侧为准
    assert.deepEqual(r.views.rejected.map(norm), baseRej, choose + ': rejecting everything gives back the base, except the chosen paragraph')
    assert.equal(norm(r.views.accepted[3]), norm('第三条 付款安排：乙方应于协议生效后 ' + who[2] + ' 个工作日内付清。'))
  }

  // ---------------- C：发版前回归的原样三份文件 ----------------
  {
    const r = await manual({ base: RC('base.docx'), main: RC('main.docx'), other: RC('other.docx'), conflictKey: 'p0', choose: 'other' })
    results.push({ case: 'C', revisions: r.revs.map((x) => [x.type, x.author, x.date, x.text, x.mark ? 'mark' : ''].join('|')), accepted: r.views.accepted[0], rejected: r.views.rejected[0] })
    // 引擎导出时一条修订会按字符段拆成几个 w:ins / w:del：同作者、同类型、同日期的连起来再比
    const has = (type, author, date, text) => r.revs.filter((x) => !x.mark && x.type === type && x.author === author && x.date === date).map((x) => x.text).join('').includes(text)
    assert.ok(has('ins', 'AI WorkDeck', '2026-11-14T16:32:38Z', 'RC回归标记0860'), 'the AI pending insertion from the base is still pending, with its date')
    assert.ok(has('del', '测试甲-管理员', '2026-11-14T16:35:53Z', 'RC回归标记0860'), 'the draft\'s deletion of the AI text is kept (stacked on the insertion)')
    assert.ok(has('ins', '测试甲-管理员', '2026-11-14T16:35:53Z', '表后总结（稿B：客户要求按季度付款）。'), 'the draft\'s new sentence is a pending insertion')
    assert.ok(r.revs.some((x) => x.mark && x.type === 'ins' && x.author === 'AI WorkDeck'), 'the AI-inserted paragraph mark is still pending')
    assert.ok(!r.revs.some((x) => x.text.includes('主稿')), 'the main side\'s wording of the chosen paragraph is gone')
    assert.equal(norm(r.views.accepted[0]), norm('表后总结（稿B：客户要求按季度付款）。'))
  }
  // ---------------- D：表格单元格里的待处理修订（台账 B13b） ----------------
  {
    const bU = await unitsOf(read('table-base.docx')), mU = await unitsOf(read('table-main.docx')), oU = await unitsOf(read('table-other.docx'))
    const at = (k) => bU.findIndex((u) => u.key === k)
    const plan = {
      mainChunks: [modify(bU, 'p1', mU[at('p1')].text), modify(bU, 't0.1.1', mU[at('t0.1.1')].text)],
      otherChunks: [modify(bU, 't0.1.0', oU[at('t0.1.0')].text)],
    }
    const built = await run('build_merge_draft', { baseBytes: read('table-base.docx'), mainBytes: read('table-main.docx'), otherBytes: read('table-other.docx'),
      mainAuthor: '张律师', otherAuthor: '李律师', plan, baseUnits: bU, name: 't.docx' })
    assert.equal(built && built.success, true, 'merge with pending changes in table cells: ' + JSON.stringify(built && { stage: built.stage, message: built.message }))
    assert.equal((await run('resolve_merge_mechanics', { action: 'accept' })).success, true)
    const exported = await run('export_document', { name: 't.docx' })
    const bytes = (await restoreRecreatedRedlineDates(exported.bytes, { recreated: built.recreated })).bytes
    assert.deepEqual(await mergeMarkedAuthors(bytes), [])
    const xml = await docXml(bytes)
    const revs = revisionsOf(xml)
    results.push({ case: 'D', revisions: revs.map((x) => [x.type, x.author, x.date, x.text].join('|')) })
    const has = (type, author, date, text) => revs.filter((x) => !x.mark && x.type === type && x.author === author && x.date === date).map((x) => x.text).join('').includes(text)
    assert.ok(has('del', '乙律师', '2026-11-02T10:00:00Z', '10') && has('ins', '乙律师', '2026-11-02T10:00:00Z', '15'), 'the draft\'s pending change in a table cell is recreated with its author and date')
    assert.ok(has('del', '甲律师', '2026-11-01T09:00:00Z', '300') && has('ins', '甲律师', '2026-11-01T09:00:00Z', '350'), 'the main side\'s pending change in the neighbouring cell is kept')
    assert.ok(has('del', '甲律师', '2026-11-01T09:00:00Z', '两') && has('ins', '甲律师', '2026-11-01T09:00:00Z', '三'), 'the main side\'s pending paragraph change is kept')
    const cell = (re) => { const m = xml.match(re); return m ? m[0] : '' }
    const tblXml = cell(/<w:tbl>[\s\S]*<\/w:tbl>/)
    const cells = [...tblXml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0])
    const acc = (frag) => [...frag.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '').matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((x) => decode(x[1])).join('')
    assert.equal(acc(cells[2]), '签约后 15 日')
    assert.equal(acc(cells[3]), '350 万元')
  }

  // ---------------- E：多段的单元格带待处理修订：停下，交给整份二选一，不猜 ----------------
  {
    const bU = await unitsOf(read('table-base.docx')), oU = await unitsOf(read('table-other-multi.docx'))
    const at = (k) => bU.findIndex((u) => u.key === k)
    const built = await run('build_merge_draft', { baseBytes: read('table-base.docx'), mainBytes: read('table-base.docx'), otherBytes: read('table-other-multi.docx'),
      mainAuthor: '张律师', otherAuthor: '李律师', plan: { mainChunks: [], otherChunks: [modify(bU, 't0.1.0', oU[at('t0.1.0')].text)] }, baseUnits: bU, name: 't.docx' })
    results.push({ case: 'E', stage: built && built.stage, message: built && built.message })
    assert.equal(built && built.success, false)
    assert.equal(built.stage, 'pending-redlines')
  }

  // ---------------- F：真机原样三份稿（主线改第一条 + 紧挨着的表格首格，后端并成一块） ----------------
  {
    const F = (f) => path.join(here, 'fixtures/merge/b13b-real', f)
    const bU = await unitsOf(read(F('base.docx'))), mU = await unitsOf(read(F('main.docx'))), oU = await unitsOf(read(F('other.docx')))
    const at = (k) => bU.findIndex((u) => u.key === k)
    // 与后端 ThreeWayAnalyzer 对这三份稿给出的计划逐字相同（段落与表格单元混在一块里）
    const plan = {
      mainChunks: [{ type: 'MODIFY', baseStart: at('p1'), baseEnd: at('t0.0.0') + 1, texts: [mU[at('p1')].text, mU[at('t0.0.0')].text], ids: [], conflict: false }],
      otherChunks: [modify(bU, 't0.1.0', oU[at('t0.1.0')].text)],
    }
    const built = await run('build_merge_draft', { baseBytes: read(F('base.docx')), mainBytes: read(F('main.docx')), otherBytes: read(F('other.docx')),
      mainAuthor: '张律师', otherAuthor: '李律师', plan, baseUnits: bU, name: 't.docx' })
    results.push({ case: 'F', success: built && built.success, stage: built && built.stage, message: built && built.message })
    assert.equal(built && built.success, true, 'a chunk mixing a paragraph and a table cell must align: ' + JSON.stringify(built && { stage: built.stage, message: built.message }))
    assert.equal((await run('resolve_merge_mechanics', { action: 'accept' })).success, true)
    const exported = await run('export_document', { name: 't.docx' })
    const bytes = (await restoreRecreatedRedlineDates(exported.bytes, { recreated: built.recreated })).bytes
    const revs = revisionsOf(await docXml(bytes))
    const has = (type, date, text) => revs.filter((x) => !x.mark && x.type === type && x.author === '测试甲-律师1' && x.date === date).map((x) => x.text).join('').includes(text)
    assert.ok(has('ins', '2026-11-15T10:45:23Z', '5') && has('del', '2026-11-15T10:45:23Z', '0'), 'the draft\'s cell change is recreated with its date: ' + JSON.stringify(revs))
    assert.ok(has('ins', '2026-11-15T10:45:40Z', '（已核）') && has('ins', '2026-11-15T10:45:44Z', '三'), 'the main side\'s cell and paragraph changes are kept')
    assert.deepEqual(await mergeMarkedAuthors(bytes), [])
  }

  console.log(JSON.stringify(results, null, 1))
  console.log(JSON.stringify({ pass: 1, fail: 0 }))
} catch (e) {
  console.log(JSON.stringify(results, null, 1))
  throw e
} finally {
  await browser.close()
  server.close()
}
