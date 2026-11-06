// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_SELECTION_CONTEXT_CHARS,
  MAX_SELECTION_PREVIEW_CHARS,
  normalizeSelectionText,
  buildActiveSelectionChip,
  readActiveSelection,
  readActivePointer,
  buildPointerFields,
  MAX_POINTER_PARAGRAPH_CHARS,
} from '../../src/pages/project-overview/activeSelectionContext.js'
import { buildAiSelectionRevisePrompt } from '../../src/utils/paragraphFormat.js'

describe('activeSelectionContext (dev-board#1430)', () => {
  it('normalizeSelectionText trims, normalizes CRLF, and caps at MAX_SELECTION_CONTEXT_CHARS', () => {
    assert.equal(normalizeSelectionText(''), '')
    assert.equal(normalizeSelectionText('   \n\t  '), '')
    assert.equal(normalizeSelectionText('  第一条\r\n第二条  '), '第一条\n第二条')
    const longText = '甲'.repeat(MAX_SELECTION_CONTEXT_CHARS + 50)
    assert.equal(normalizeSelectionText(longText).length, MAX_SELECTION_CONTEXT_CHARS)
  })

  it('buildActiveSelectionChip returns null when no active doc or mismatched fileId', () => {
    assert.equal(buildActiveSelectionChip({ fileId: 10, text: '违约金条款' }, null), null)
    assert.equal(
      buildActiveSelectionChip({ fileId: 10, text: '违约金条款' }, { id: '11', name: '合同.docx' }),
      null
    )
    assert.equal(
      buildActiveSelectionChip({ fileId: 10, text: '   ' }, { id: '10', name: '合同.docx' }),
      null
    )
  })

  it('buildActiveSelectionChip builds preview and length for matching active doc', () => {
    const chip = buildActiveSelectionChip(
      { fileId: 10, text: '违约金按合同总额百分之三十计算\n逾期每日万分之五' },
      { id: '10', name: '合同.docx' }
    )
    assert.ok(chip)
    assert.equal(chip.text, '违约金按合同总额百分之三十计算\n逾期每日万分之五')
    assert.equal(chip.length, 24)
    assert.equal(chip.preview, '违约金按合同总额百分之三十计算 逾期每日万分之五')

    const longRaw = '一二三四五六七八九十'.repeat(5)
    const longChip = buildActiveSelectionChip(
      { fileId: 10, text: longRaw },
      { id: '10', name: '合同.docx' }
    )
    assert.equal(longChip.preview, longRaw.slice(0, MAX_SELECTION_PREVIEW_CHARS) + '…')
  })

  it('readActiveSelection reads from LibreOfficeEditor via background get_selection', async () => {
    const calls = []
    const libreRefs = {
      'left:101': {
        ready: true,
        docLoadFailed: false,
        _reloading: false,
        file: { id: 101 },
        executor: {
          async executeCommand(action, params, opts) {
            calls.push({ action, params, opts })
            return { success: true, text: '  第八条 违约责任  ' }
          },
        },
      },
    }
    const sel = await readActiveSelection(libreRefs, {}, { side: 'left', fileId: 101 })
    assert.deepEqual(sel, { fileId: 101, text: '第八条 违约责任' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].action, 'get_selection')
    assert.deepEqual(calls[0].opts, { background: true })
  })

  it('readActiveSelection reads from PlainTextEditor getSelectionText', async () => {
    const plainRefs = {
      left: {
        phase: 'ready',
        file: { id: 202 },
        getSelectionText() {
          return '  revise this section  '
        },
      },
    }
    const sel = await readActiveSelection({}, plainRefs, { side: 'left', fileId: 202 })
    assert.deepEqual(sel, { fileId: 202, text: 'revise this section' })
  })

  it('buildAiSelectionRevisePrompt formats prompt with fileName, excerpt, and instruction', () => {
    const t = (key, params = {}) => {
      if (key === 'editor.format.aiSelectionRevisePrompt') {
        return `请针对《${params.name}》中选中的以下内容进行修订：\n「${params.selection}」\n修订要求：${params.instruction}`
      }
      return key
    }
    const prompt = buildAiSelectionRevisePrompt({
      fileName: '技术服务合同.docx',
      selectedText: '乙方应于三日内交付全部成果',
      instruction: '改为五个工作日内交付，并补充验收标准',
    }, t)
    assert.match(prompt, /《技术服务合同\.docx》/)
    assert.match(prompt, /乙方应于三日内交付全部成果/)
    assert.match(prompt, /改为五个工作日内交付，并补充验收标准/)
  })
})

describe('Writer 指针 (get_ai_pointer)', () => {
  it('buildPointerFields: 选区取实时文本并带锚点/段号', () => {
    assert.deepEqual(
      buildPointerFields({ kind: 'selection', selectionText: '  违约金条款 ', anchorId: '__ai_anchor_3', paragraphIndex: 5 }),
      { pointerAnchorId: '__ai_anchor_3', pointerParagraphIndex: 5, selectionText: '违约金条款' }
    )
  })

  it('buildPointerFields: 无选区带光标段落，超长安全截断，缺锚点/段号则省略', () => {
    const r = buildPointerFields({ kind: 'cursor', paragraphText: '甲'.repeat(MAX_POINTER_PARAGRAPH_CHARS + 10), paragraphIndex: -1 })
    assert.equal(r.cursorParagraphText.length, MAX_POINTER_PARAGRAPH_CHARS)
    assert.equal('pointerAnchorId' in r, false)
    assert.equal('pointerParagraphIndex' in r, false)
  })

  it('buildPointerFields: none / 空 / 非法输入返回 {}', () => {
    assert.deepEqual(buildPointerFields(null), {})
    assert.deepEqual(buildPointerFields({ kind: 'none' }), {})
    assert.deepEqual(buildPointerFields({ kind: 'cursor', paragraphText: '  ' }), {})
    assert.deepEqual(buildPointerFields({ kind: 'selection', selectionText: '', anchorId: 'x' }), {})
  })

  it('readActivePointer: 调 get_ai_pointer；非 Writer / 失败返回 null', async () => {
    const calls = []
    const mk = (extra = {}) => ({
      ready: true, file: { id: 7 }, docKind: 'writer',
      executor: { executeCommand: async (a) => { calls.push(a); return { success: true, kind: 'cursor', paragraphText: '段' } } },
      ...extra,
    })
    assert.equal((await readActivePointer({ 'left:7': mk() }, { side: 'left', fileId: 7 })).kind, 'cursor')
    assert.deepEqual(calls, ['get_ai_pointer'])
    assert.equal(await readActivePointer({ 'left:7': mk({ docKind: 'sheet' }) }, { side: 'left', fileId: 7 }), null)
    const bad = mk({ executor: { executeCommand: async () => { throw new Error('x') } } })
    assert.equal(await readActivePointer({ 'left:7': bad }, { side: 'left', fileId: 7 }), null)
  })
})
