// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// model-matrix 判分前的「写命令之后确有一次上传」核对（独立成模块以便单测，model-matrix.mjs 导入即运行 main）。
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 编辑器写命令：doc_* 里除去只读/导出/列举的。宁可多等（最多 timeoutMs），不漏判。
const READ_ONLY_DOC_RE = /^doc_(get_|find_text$|list_|table_read|audit|view_|export_|revisions$|read)/
export const isDocWriteTool = t => /^(doc_|write_docx)/.test(t) && !READ_ONLY_DOC_RE.test(t)

/**
 * 服务器内容摘要相对 before 变了，且连续两次读取一致（没有更晚的上传在途）= true；
 * 超时 = false（调用方据此记 staleRead，不假装读到的是终稿）。
 * @param {() => Promise<string|null>} readSha
 * @param {string} before 本轮开始前的摘要
 */
export async function waitSavedAfterWrite(readSha, before, { sleepMs = 1500, timeoutMs = 30000 } = {}) {
  const end = Date.now() + timeoutMs
  let last = null
  for (;;) {
    const cur = await readSha()
    if (cur && cur !== before) { if (cur === last) return true; last = cur } else last = null
    if (Date.now() >= end) return false
    await sleep(sleepMs)
  }
}
