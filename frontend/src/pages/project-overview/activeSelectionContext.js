// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 当前活跃文档选区上下文的读取与胶囊归一化（dev-board#1430）。
//
// 零依赖纯函数（不 import Vue / uni / '@/' 别名），node --test 可直接导入；
// 单测在 frontend/tests/tab-visibility/active-selection-context.test.mjs。

export const MAX_SELECTION_CONTEXT_CHARS = 2000
export const MAX_SELECTION_PREVIEW_CHARS = 26

function sliceSafeCodePoints(str, maxChars) {
  if (!str || str.length <= maxChars) return str || ''
  let end = maxChars
  const prev = str.charCodeAt(end - 1)
  const curr = str.charCodeAt(end)
  if (prev >= 0xD800 && prev <= 0xDBFF && curr >= 0xDC00 && curr <= 0xDFFF) {
    end -= 1
  }
  return str.slice(0, end)
}

/**
 * 归一化选区文本：去首尾空白，超长安全截断（不劈开 UTF-16 代理对）。
 */
export function normalizeSelectionText(raw, maxChars = MAX_SELECTION_CONTEXT_CHARS) {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.replace(/\r\n?/g, '\n').trim()
  if (!trimmed) return ''
  return sliceSafeCodePoints(trimmed, maxChars)
}

/**
 * 计算输入框上方「已选中 · 「…」」胶囊的展示数据（null = 不显示）。
 *
 * @param activeSelection  宿主传入的 { fileId, text } 或字符串
 * @param activeDocChip    当前活跃文档 chip（{ id, name }），被摘掉或非文档标签时为 null
 */
export function buildActiveSelectionChip(activeSelection, activeDocChip) {
  if (!activeDocChip || !activeDocChip.id) return null
  if (!activeSelection) return null
  if (typeof activeSelection === 'object' && activeSelection.fileId != null) {
    if (String(activeSelection.fileId) !== String(activeDocChip.id)) return null
  }
  const rawText = typeof activeSelection === 'string' ? activeSelection : activeSelection.text
  const text = normalizeSelectionText(rawText)
  if (!text) return null
  const singleLine = text.replace(/\s+/g, ' ').trim()
  const codePoints = Array.from(singleLine)
  const preview = codePoints.length > MAX_SELECTION_PREVIEW_CHARS
    ? codePoints.slice(0, MAX_SELECTION_PREVIEW_CHARS).join('') + '…'
    : singleLine
  return {
    fileId: String(activeDocChip.id),
    text,
    preview,
    length: Array.from(text).length,
    fullPreview: sliceSafeCodePoints(singleLine, 160),
  }
}

/**
 * 从当前活跃编辑器实例（LOWA Writer 或 PlainTextEditor）读取当前选区文本。
 *
 * @param libreRefs      形如 { 'left:123': inst }，来自 project-overview 的 _libreRefs
 * @param plainTextRefs  形如 { left: inst, right: inst }，来自 project-overview 的 _plainTextRefs
 * @param options        { side, fileId }
 * @returns {Promise<{ fileId: number, text: string } | null>}
 */
export async function readActiveSelection(libreRefs, plainTextRefs, { side, fileId } = {}) {
  const id = Number(fileId)
  if (!id) return null

  const lRefs = libreRefs || {}
  const keys = side ? [`${side}:${id}`, `left:${id}`, `right:${id}`] : [`left:${id}`, `right:${id}`]
  for (const key of keys) {
    const inst = lRefs[key]
    if (!inst) continue
    const usable = inst.ready && !inst.docLoadFailed && !inst._reloading
      && (!inst.docKind || inst.docKind === 'writer')
      && Number(inst.file && inst.file.id) === id
      && inst.executor && typeof inst.executor.executeCommand === 'function'
    if (!usable) continue
    try {
      const res = await inst.executor.executeCommand('get_selection', {}, { background: true })
      const text = (res && res.success !== false && res.hasSelection !== false)
        ? normalizeSelectionText(res.text)
        : ''
      return { fileId: id, text }
    } catch (e) {
      return { fileId: id, text: '' }
    }
  }

  const pRefs = plainTextRefs || {}
  const sides = side ? [side, 'left', 'right'] : ['left', 'right']
  for (const s of sides) {
    const ptx = pRefs[s]
    if (!ptx) continue
    if (ptx.phase === 'ready' && Number(ptx.file && ptx.file.id) === id && typeof ptx.getSelectionText === 'function') {
      try {
        return { fileId: id, text: normalizeSelectionText(ptx.getSelectionText()) }
      } catch (e) {
        return { fileId: id, text: '' }
      }
    }
  }

  return { fileId: id, text: '' }
}
