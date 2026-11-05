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

export const MAX_POINTER_PARAGRAPH_CHARS = 600

/**
 * 发送时读取 Writer 指针（选区 + 锚点 + 段号 / 光标段落 + 锚点 + 段号）。
 * 只对 LOWA Writer 有效；读不到（非 Writer / 未就绪 / 命令失败）返回 null，调用方退回旧的选区胶囊。
 *
 * @returns {Promise<{ kind: 'selection'|'cursor'|'none', ... } | null>}
 */
export const POINTER_READ_TIMEOUT_MS = 800

export async function readActivePointer(libreRefs, { side, fileId } = {}) {
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
      // 发送路径等不起：office 线程正忙（AI 修订风暴、整篇导出）时 800ms 内拿不到就放弃，
      // 退回只带选区文字的旧行为，不拖住发送。
      const res = await inst.executor.executeCommand('get_ai_pointer', {}, { background: true, timeoutMs: POINTER_READ_TIMEOUT_MS })
      return res && res.success !== false ? res : null
    } catch (e) {
      return null
    }
  }
  return null
}

/**
 * 把 get_ai_pointer 的结果折成 activeContext 里要多带的字段（纯函数）。
 * 选区：selectionText 以实时读到的为准（胶囊可能已过期），并带 anchor/段号；
 * 无选区：cursorParagraphText + anchor/段号。其余情形返回 {}，由调用方保持原行为。
 */
export function buildPointerFields(pointer) {
  if (!pointer || typeof pointer !== 'object') return {}
  const out = {}
  if (pointer.anchorId) out.pointerAnchorId = String(pointer.anchorId)
  if (Number.isInteger(pointer.paragraphIndex) && pointer.paragraphIndex >= 0) {
    out.pointerParagraphIndex = pointer.paragraphIndex
  }
  if (pointer.kind === 'selection') {
    const text = normalizeSelectionText(pointer.selectionText)
    if (!text) return {}
    out.selectionText = text
    return out
  }
  if (pointer.kind === 'cursor') {
    const text = sliceSafeCodePoints(String(pointer.paragraphText || '').trim(), MAX_POINTER_PARAGRAPH_CHARS)
    if (!text) return {}
    out.cursorParagraphText = text
    return out
  }
  return {}
}
