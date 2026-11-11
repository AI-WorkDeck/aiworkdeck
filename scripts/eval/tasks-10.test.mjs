// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// tasks-10 的 outcomeCheck 离线单测：手工造 ctx 桩（文件表、docx XML、文件正文、调用参数、最终回复），每题至少一个通过、一个不通过用例。
// 用法：node --test scripts/eval/tasks-10.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const { sentences } = JSON.parse(fs.readFileSync(path.join(HERE, 'sentences/tasks-10.json'), 'utf8'))
const byId = Object.fromEntries(sentences.map(s => [s.id, s]))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const check = (id, ctx) => new AsyncFunction('ctx', byId[id].expect.outcomeCheck)(ctx)

// ---- docx XML 片段 ----
const t = s => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`
const p = (...parts) => `<w:p>${parts.join('')}</w:p>`
const ins = s => `<w:ins w:id="9" w:author="AI"><w:r><w:t>${s}</w:t></w:r></w:ins>`
const del = s => `<w:del w:id="8" w:author="AI"><w:r><w:delText>${s}</w:delText></w:r></w:del>`
const cmt = (id, s) => `<w:commentRangeStart w:id="${id}"/>${t(s)}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`
const doc = (...ps) => `<?xml version="1.0"?><w:document><w:body>${ps.join('')}</w:body></w:document>`
const comments = (...ss) => `<w:comments>${ss.map((s, i) => `<w:comment w:id="${i}"><w:p>${t(s)}</w:p></w:comment>`).join('')}</w:comments>`
const tbl = rows => `<w:tbl>${rows.map(r => `<w:tr>${r.map(c => `<w:tc>${p(t(c))}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`

const HEAD = [p(t('设备购销合同（虚构示范）')), p(t('甲方：示范精密制造有限公司；乙方：样例智能设备有限公司。'))]
const P3 = p(t('第三条 交付：甲方应在收到货物后 15 日内完成验收并出具书面验收单。'))
const P4 = (c = false) => c ? p(t('第四条 '), cmt(0, '违约金'), t('：违约方应按合同总价的 20% 支付违约金。')) : p(t('第四条 违约金：违约方应按合同总价的 20% 支付违约金。'))

/**
 * ctx 桩（tools = 后端日志里的工具序列）。files: [{id,name,is_folder?,is_deleted?,parent_id?, doc?, parts?, text?, sha?}]
 * bytes(id) 返回文件记录本身，docxXml(buf, part) 取它的 doc / parts[part]（缺部件时抛错，与 unzip -p 一致）。
 */
function ctx({ files = [], tasks = [], tools = [], finalText = '' } = {}) {
  const rows = files.map(f => ({ parent_id: null, is_folder: false, is_deleted: false, ...f }))
  return {
    files: async () => rows.map(({ id, name, parent_id, is_folder, is_deleted }) => ({ id, name, parent_id, is_folder, is_deleted })),
    tasks: async () => tasks,
    tools, finalText,
    bytes: async id => rows.find(f => f.id === id),
    docxXml: (buf, part = 'word/document.xml') => {
      const x = part === 'word/document.xml' ? buf.doc : buf.parts?.[part]
      if (x == null) throw new Error('unzip: cannot find ' + part)
      return x
    },
    api: async (m, url) => { const id = Number(/\/api\/files\/(\d+)\/text/.exec(url)?.[1]); const f = rows.find(r => r.id === id); return f ? { code: 0, data: f.text ?? '' } : { code: -1 } },
    sha256: buf => buf.sha ?? 'changed',
    fixtureSha256: name => 'fixture:' + name,
  }
}
const pass = async (id, c) => assert.equal(await check(id, c), true, id + ' 应通过')
const fail = async (id, c, why) => assert.equal(await check(id, c), false, id + ' 应不通过：' + why)

test('tasks-10 结构：10 题、都是 task、无 firstToolAnyOf/mustUse、都有 maxRounds 与 outcomeCheck', () => {
  assert.equal(sentences.length, 10)
  for (const s of sentences) {
    assert.equal(s.task, true, s.id)
    assert.equal(s.expect.firstToolAnyOf, undefined, s.id)
    assert.equal(s.expect.mustUse, undefined, s.id)
    assert.ok(Number.isInteger(s.expect.maxRounds), s.id)
    assert.ok(s.expect.outcomeCheck, s.id)
  }
  assert.deepEqual(byId['t10-two-turn-delete-confirm'].followUps.map(f => f.text), ['执行', '执行'])
})

test('t01 四步（改措辞→批注→接受修订→导出）', async () => {
  const good = { id: 1, name: '合同.docx', doc: doc(...HEAD, P3, P4(true)), parts: { 'word/comments.xml': comments('违约金比例需与客户确认') } }
  const pdf = { id: 2, name: '合同.pdf', text: '第三条 交付：甲方应在收到货物后15日内完成验收并出具书面\n验收单。' }
  await pass('t01-four-step-explicit', ctx({ files: [good, pdf] }))
  await fail('t01-four-step-explicit', ctx({ files: [good] }), '没有 PDF')
  await fail('t01-four-step-explicit', ctx({ files: [good, { ...pdf, text: '第三条 交付：7 日内验收' }] }), 'PDF 是修改前导出的')
  await fail('t01-four-step-explicit', ctx({ files: [{ ...good, doc: doc(...HEAD, p(t('第三条 交付：甲方应在收到货物后 '), del('7'), ins('15'), t(' 日内完成验收并出具书面验收单。')), P4(true)) }, pdf] }), '修订没接受')
  await fail('t01-four-step-explicit', ctx({ files: [{ ...good, doc: doc(...HEAD, P3, P4()) }, pdf] }), '第四条没有批注')
  await fail('t01-four-step-explicit', ctx({ files: [{ ...good, parts: {} }, pdf] }), '没有 comments.xml')
  await fail('t01-four-step-explicit', ctx({ files: [{ ...good, doc: doc(...HEAD, p(t('第三条 交付：甲方应在收到货物后 15 日内验收。')), P4(true)) }, pdf] }), '措辞没改')
})

test('t02 第四条至少两条批注', async () => {
  const base = c => ({ id: 1, name: '合同.docx', doc: doc(...HEAD, p(t('第三条 交付')), p(t('第四条 违约金：'), ...c, t('应按合同总价的 50% 向守约方支付违约金。')), p(t('第五条 争议解决'))) })
  await pass('t02-penalty-review-comments', ctx({ files: [base([cmt(0, '任一方违约，'), cmt(1, '')])] }))
  await fail('t02-penalty-review-comments', ctx({ files: [base([cmt(0, '任一方违约，')])] }), '只有一条')
  await fail('t02-penalty-review-comments', ctx({ files: [{ id: 1, name: '合同.docx', doc: doc(p(t('第三条'), cmt(0, 'x')), p(t('第五条'), cmt(1, 'y')), p(t('第四条 违约金'))) }] }), '批注不在第四条')
  await fail('t02-penalty-review-comments', ctx({ files: [] }), '宿主文件不在')
})

test('t03 比对写成差异说明', async () => {
  const v = [{ id: 1, name: '股权转让协议v1.docx' }, { id: 2, name: '股权转让协议v2.docx' }]
  const memo = { id: 3, name: '差异说明.docx', text: '一、第三条付款期限由 10 日改为 15 日；二、第五条违约金由 10% 调整为 20%；三、新增第七条保密条款。' }
  await pass('t03-compare-to-memo', ctx({ files: [...v, memo] }))
  await fail('t03-compare-to-memo', ctx({ files: [...v, { ...memo, text: '第三条付款期限改为 15 日；违约金调整为 20%。' }] }), '漏了保密')
  await fail('t03-compare-to-memo', ctx({ files: [...v, { ...memo, name: '比对.docx' }] }), '文件名不对')
  await fail('t03-compare-to-memo', ctx({ files: [v[0], memo] }), '原件少了一份')
  await fail('t03-compare-to-memo', ctx({ files: [...v, { ...memo, is_deleted: true }] }), '差异说明在回收站')
})

test('t04 违约金对比表', async () => {
  const rows = [['合同', '相对方', '违约金标准'], ['设备采购合同', '样例华东电子有限公司', '逾期交货每日按合同总价 0.5%，累计不超过 10%'], ['软件服务合同', '样例华南软件有限公司', '服务费总额的 20%'], ['厂房租赁合同', '样例华北物业有限公司', '未付租金每日万分之五']]
  const f = (r, name = '违约金对比表.docx') => ({ id: 9, name, doc: doc(p(t('违约金条款对比表')), tbl(r)) })
  await pass('t04-penalty-table', ctx({ files: [f(rows)] }))
  const transposed = rows[0].map((_, c) => rows.map(r => r[c]))
  await pass('t04-penalty-table', ctx({ files: [f(transposed)] })) // 合同作列（基线实测）
  await pass('t04-penalty-table', ctx({ files: [{ id: 9, name: '违约金对比表.docx', doc: doc(tbl([['项目', '内容'], ['合同名称', '设备采购合同（华东）']]), tbl(transposed)) }] })) // 先逐份明细、后汇总
  await fail('t04-penalty-table', ctx({ files: [f(rows.slice(0, 3))] }), '少一行')
  await fail('t04-penalty-table', ctx({ files: [f([rows[0], rows[1], ['软件服务合同', '样例华南软件有限公司', '服务费总额的 10%'], rows[3]])] }), '华南值错')
  await fail('t04-penalty-table', ctx({ files: [{ id: 9, name: '违约金对比表.docx', doc: doc(...rows.map(r => p(t(r.join(' | '))))) }] }), '不是表格')
  await fail('t04-penalty-table', ctx({ files: [{ id: 9, name: '违约金对比表.docx', doc: doc(tbl(rows.slice(0, 3)), p(t('厂房租赁合同（华北）：每日万分之五'))) }] }), '华北只写在表外')
  await fail('t04-penalty-table', ctx({ files: [f(rows, '对比.docx')] }), '文件名不对')
})

test('t05 上诉期+待办', async () => {
  const ok = { finalText: '上诉期届满日为 2026年11月17日（周二）。已建待办。', tasks: [{ id: 1, title: '提交上诉状', due_date: '2026-11-17', source: 'AI' }] }
  await pass('t05-appeal-deadline-reminder', ctx(ok))
  await fail('t05-appeal-deadline-reminder', ctx({ ...ok, tasks: [{ id: 1, title: '提交上诉状', due_date: '2026-11-16' }] }), '日期算错')
  await fail('t05-appeal-deadline-reminder', ctx({ ...ok, tasks: [] }), '没建待办')
  await fail('t05-appeal-deadline-reminder', ctx({ ...ok, finalText: '已建待办。' }), '回复没给日期')
})

test('t06 六个文件分类 + 批量移动', async () => {
  const folders = [{ id: 10, name: '01 诉讼文书', is_folder: true }, { id: 11, name: '02 证据', is_folder: true }, { id: 12, name: '03 其他', is_folder: true }]
  const placed = [['起诉状.docx', 10], ['代理词.docx', 10], ['证据目录.docx', 11], ['证据1-买卖合同.docx', 11], ['证据2-沟通记录.docx', 11], ['会议纪要.docx', 12]].map(([name, parent_id], i) => ({ id: i + 1, name, parent_id }))
  const files = [...folders, ...placed]
  await pass('t06-organise-six-files', ctx({ files, tools: ['doc_list_project_files', 'move_files'] }))
  await pass('t06-organise-six-files', ctx({ files, tools: ['doc_list_project_files', 'move_files', 'move_files'] })) // 第一次参数写错、改正重发（基线实测）
  await fail('t06-organise-six-files', ctx({ files, tools: ['move_files', 'move_files', 'move_files', 'move_files', 'move_files', 'move_files'] }), '逐个移动')
  await fail('t06-organise-six-files', ctx({ files: [...folders, ...placed.map(f => f.name === '会议纪要.docx' ? { ...f, parent_id: 11 } : f)], tools: ['move_files'] }), '会议纪要放错')
  await fail('t06-organise-six-files', ctx({ files: [...folders, ...placed.map(f => f.name === '代理词.docx' ? { ...f, is_deleted: true } : f)], tools: ['move_files'] }), '文件被删')
  await fail('t06-organise-six-files', ctx({ files: placed.map(f => ({ ...f, parent_id: null })), tools: ['move_files'] }), '没建文件夹、没移动')
})

test('t07 改名称→律所格式→导出', async () => {
  const fmt = '<w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/></w:pPr>'
  const host = { id: 1, name: '合同.docx', doc: doc(p(t('设备购销合同')), p(fmt, t('甲方：示范精密制造有限公司；乙方：样例智能'), del('设备有限公司'), ins('装备股份有限公司'), t('。'))), parts: { 'word/styles.xml': '<w:styles/>' } }
  const pdf = { id: 2, name: '合同.pdf', text: '乙方：样例智能设备有限公司装备股份有限\n公司。' }
  await pass('t07-rename-format-export', ctx({ files: [host, pdf] }))
  await pass('t07-rename-format-export', ctx({ files: [{ ...host, doc: doc(p(t('乙方：样例智能装备股份有限公司'))), parts: { 'word/styles.xml': '<w:rFonts w:eastAsia="楷体_GB2312"/>' } }, pdf] }))
  await fail('t07-rename-format-export', ctx({ files: [{ ...host, doc: host.doc.replace(fmt, '') }, pdf] }), '没套格式')
  await fail('t07-rename-format-export', ctx({ files: [host, { ...pdf, text: '乙方：样例智能设备有限公司。' }] }), 'PDF 早于修改')
  await fail('t07-rename-format-export', ctx({ files: [host] }), '没导出')
  await fail('t07-rename-format-export', ctx({ files: [{ ...host, doc: doc(p(fmt, t('乙方：样例智能设备有限公司；样例智能装备股份有限公司'))) }, pdf] }), '旧名还在')
})

test('t08 拒绝第三条修订、其余接受', async () => {
  const f = (p3, p4) => ({ files: [{ id: 1, name: '合同.docx', doc: doc(...HEAD, p3, p4) }] })
  await pass('t08-reject-one-accept-rest', ctx(f(p(t('第三条 交付：甲方应在收到货物后 7 日内验收。')), P4())))
  await fail('t08-reject-one-accept-rest', ctx(f(p(t('第三条 交付：甲方应在收到货物后 15 日内验收。')), P4())), '第三条被接受了')
  await fail('t08-reject-one-accept-rest', ctx(f(p(t('第三条 交付：甲方应在收到货物后 7 日内验收。')), p(t('第四条 违约金：')))), '第四条被拒绝了')
  await fail('t08-reject-one-accept-rest', ctx(f(p(t('第三条 交付：甲方应在收到货物后 7 日内验收。')), p(t('第四条 违约金：'), ins('违约方应按合同总价的 20% 支付违约金。')))), '第四条修订还挂着')
})

test('t09 法源不可用时核对法条', async () => {
  const op = { id: 1, name: '意见书.docx', sha: 'fixture:opinion.docx' }
  const txt = '第五百零九条引用正确。第1082条引用有误：该条是离婚限制条款，违约金调整应为第585条。法规库当前不可用，以上结论待核实。'
  await pass('t09-citations-source-down', ctx({ files: [op], finalText: txt }))
  await pass('t09-citations-source-down', ctx({ files: [op], finalText: '第1082条编号错误，应为第585条。由于当前法规数据库（北大法宝）暂时不可用，以上系基于记忆，建议通过 flk.npc.gov.cn 复核。' }))
  await fail('t09-citations-source-down', ctx({ files: [op], finalText: '第509条准确。第1082条编号错误，应为第585条第2款，第1082条是离婚限制条款。' }), '没说未核实')
  await fail('t09-citations-source-down', ctx({ files: [op], finalText: '两处引用都有依据，待核实。' }), '没点出 1082')
  await fail('t09-citations-source-down', ctx({ files: [{ ...op, sha: 'changed' }], finalText: txt }), '意见书被改了')
})

test('t10 两轮确认：删旧稿、建定稿、移合同', async () => {
  const done = [{ id: 1, name: '旧稿', is_folder: true, is_deleted: true }, { id: 2, name: '合同草稿.docx', parent_id: 1, is_deleted: true }, { id: 3, name: '定稿', is_folder: true }, { id: 4, name: '合同.docx', parent_id: 3 }]
  await pass('t10-two-turn-delete-confirm', ctx({ files: done }))
  await fail('t10-two-turn-delete-confirm', ctx({ files: done.map(f => f.id === 1 ? { ...f, is_deleted: false } : f) }), '旧稿还在（停在确认卡没继续）')
  await fail('t10-two-turn-delete-confirm', ctx({ files: done.map(f => f.id === 4 ? { ...f, parent_id: null } : f) }), '合同没移进定稿')
  await fail('t10-two-turn-delete-confirm', ctx({ files: done.map(f => f.id === 4 ? { ...f, is_deleted: true } : f) }), '合同被删了')
})
