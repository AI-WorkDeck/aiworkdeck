// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { waitSavedAfterWrite, isDocWriteTool } from './save-wait.mjs'

const seq = (...vals) => { let i = 0; return async () => vals[Math.min(i++, vals.length - 1)] }
const fast = { sleepMs: 1, timeoutMs: 200 }

test('内容一直没变（宿主没上传）= 未保存，不读旧稿冒充终稿', async () => {
  assert.equal(await waitSavedAfterWrite(seq('a'), 'a', fast), false)
})
test('内容变了且连续两次一致 = 已保存', async () => {
  assert.equal(await waitSavedAfterWrite(seq('a', 'b', 'b'), 'a', fast), true)
})
test('变了之后又有更晚的上传在途：要等到稳定', async () => {
  const calls = []
  const read = seq('a', 'b', 'c', 'c')
  assert.equal(await waitSavedAfterWrite(async () => { const v = await read(); calls.push(v); return v }, 'a', fast), true)
  assert.deepEqual(calls, ['a', 'b', 'c', 'c'])
})
test('读不到（null）视为未变', async () => {
  assert.equal(await waitSavedAfterWrite(seq(null), 'a', fast), false)
})
test('写命令分类：格式/查找替换算写，读与导出不算', () => {
  for (const t of ['doc_replace_at_anchor', 'doc_find_replace', 'doc_set_paragraph_format', 'doc_format_selection', 'doc_table_add_row', 'doc_accept_all_revisions']) assert.ok(isDocWriteTool(t), t)
  for (const t of ['doc_get_document_text', 'doc_find_text', 'doc_list_project_files', 'doc_list_revisions', 'doc_table_read', 'doc_export_pdf', 'doc_revisions', 'doc_view_pages', 'ask_user']) assert.ok(!isDocWriteTool(t), t)
})
