// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canConvertItemToPdf,
  canMergeItemsToPdf,
  resolveFileExtension,
} from '../src/utils/fileTreePdfActions.js'

test('单文件转 PDF：支持 Word / PPT / Excel / 图片，拒绝文件夹、已读只读、回收站和已是 PDF 的文件（dev-board#1291）', () => {
  for (const name of ['合同.docx', '旧版.doc', '汇报.pptx', '旧版.ppt', '台账.xlsx', '旧表.xls', '营业执照.png', '身份证.JPG', '印章.webp', '扫描件.svg']) {
    assert.equal(canConvertItemToPdf({ name, isFolder: false }, 'normal'), true, name)
  }
  assert.equal(canConvertItemToPdf({ name: '已是PDF.pdf', isFolder: false }, 'normal'), false)
  assert.equal(canConvertItemToPdf({ name: '文件夹', isFolder: true }, 'normal'), false)
  assert.equal(canConvertItemToPdf({ name: '合同.docx', isFolder: false, readOnly: true }, 'normal'), false)
  assert.equal(canConvertItemToPdf({ name: '合同.docx', isFolder: false }, 'recycle'), false)
  assert.equal(resolveFileExtension({ fileType: 'DOCX' }), 'docx')
})

test('多选合并为 PDF：至少 2 个支持转 PDF 或已是 PDF 的文件，且不含文件夹或不支持类型（dev-board#1291）', () => {
  assert.equal(canMergeItemsToPdf([
    { id: 1, name: '主合同.docx', isFolder: false },
    { id: 2, name: '附件清单.xlsx', isFolder: false },
    { id: 3, name: '签字页.png', isFolder: false },
    { id: 4, name: '营业执照.pdf', isFolder: false },
  ], 'normal'), true)

  assert.equal(canMergeItemsToPdf([
    { id: 1, name: '仅一个文件.docx', isFolder: false },
  ], 'normal'), false)

  assert.equal(canMergeItemsToPdf([
    { id: 1, name: '主合同.docx', isFolder: false },
    { id: 2, name: '子目录', isFolder: true },
  ], 'normal'), false)

  assert.equal(canMergeItemsToPdf([
    { id: 1, name: '主合同.docx', isFolder: false },
    { id: 2, name: '录音.mp3', isFolder: false },
  ], 'normal'), false)

  assert.equal(canMergeItemsToPdf([
    { id: 1, name: '主合同.docx', isFolder: false },
    { id: 2, name: '附件.xlsx', isFolder: false },
  ], 'recycle'), false)
})
