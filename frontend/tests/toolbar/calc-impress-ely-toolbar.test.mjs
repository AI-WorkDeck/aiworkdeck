// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#1428：Excel (calc) 与 PPT (impress) 全面对齐 ElyOffice 自建工具栏、公式栏与 PropertyGroup 检查器。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CN_FONT_SIZES, PT_FONT_SIZES } from '../../src/utils/paragraphFormat.js'
import zh from '../../src/locales/zh-CN/editor.js'
import en from '../../src/locales/en-US/editor.js'

const EDITOR_SRC = readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
const TOOLBAR_SRC = readFileSync(new URL('../../src/components/EditorToolbar.vue', import.meta.url), 'utf8')
const TEMPLATE = TOOLBAR_SRC.slice(TOOLBAR_SRC.indexOf('<template>'), TOOLBAR_SRC.lastIndexOf('</template>'))
const WORKER_SRC = readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')

function loadToolbarComponent() {
  const script = TOOLBAR_SRC.match(/<script>([\s\S]*?)<\/script>/)[1]
  return new Function(
    'bindHorizontalWheel', 'watchScrollEdges', 'isEnglish', 'host',
    'CN_FONT_SIZES', 'PT_FONT_SIZES', 'ParagraphFormatPanel', 'SystemFontsPanel',
    script.replace(/^import .*$/gm, '').replace('export default', 'return'),
  )(() => () => {}, () => () => {}, () => false, {}, CN_FONT_SIZES, PT_FONT_SIZES, {}, {})
}

function makeToolbarVm(docKind = 'writer', customHandler = null) {
  const component = loadToolbarComponent()
  const calls = []
  const emitted = []
  const vm = {
    docKind,
    $t: (k) => k.split('.').slice(1).reduce((v, p) => v && v[p], zh) || k,
    $emit: (e, p) => emitted.push([e, p]),
    $refs: {},
    calls,
    emitted,
    executor: {
      executeCommand: async (action, params) => {
        calls.push({ action, params })
        if (customHandler) {
          const res = await customHandler(action, params)
          if (res !== undefined) return res
        }
        if (action === 'get_ui_state') {
          if (vm.docKind === 'calc') {
            return {
              success: true,
              docKind: 'calc',
              character: { bold: false, italic: false, sizePt: 11, font: '微软雅黑', color: 'auto', highlight: 'none' },
              paragraph: { alignment: 'left' },
              selection: { collapsed: true, inTable: true, address: 'B3', range: 'B3:D5', cellName: 'B3', rangeName: 'B3:D5', sheetName: '资产表' },
              view: { zoom: 100, showGrid: true },
              calc: {
                sheet: '资产表',
                sheetName: '资产表',
                sheets: ['资产表', '负债表'],
                sheetNames: ['资产表', '负债表'],
                address: 'B3',
                cellName: 'B3',
                range: 'B3:D5',
                rangeName: 'B3:D5',
                row: 2,
                col: 1,
                rowCount: 3,
                colCount: 3,
                formula: '=SUM(B1:B2)',
                value: 1200,
                text: '1200',
                hAlign: 'right',
                vAlign: 'center',
                wrap: false,
                merged: false,
                numberFormat: '#,##0.00',
                autoFilter: false,
                protected: false,
                hasFrozenPanes: false,
                showGrid: true,
              },
            }
          }
          if (vm.docKind === 'impress') {
            return {
              success: true,
              docKind: 'impress',
              character: { bold: true, italic: false, sizePt: 24, font: '微软雅黑', color: '#1A1916', highlight: 'none' },
              paragraph: { alignment: 'center' },
              selection: { collapsed: false, inTable: false, hasShape: true, shapeIndex: 0, shapeName: 'Title 1' },
              view: { zoom: 100 },
              impress: {
                slideNumber: 2,
                currentSlideIndex: 1,
                slideCount: 5,
                layout: 1,
                layoutName: '标题+内容',
                masterName: 'Default',
                masterPages: ['Default', 'Corporate'],
                widthPt: 793.7,
                heightPt: 446.5,
                notesText: '本页演讲备注',
                selectedShapeIndex: 0,
                selectedShapeName: 'Title 1',
                selectedShape: {
                  index: 0,
                  name: 'Title 1',
                  shapeName: 'Title 1',
                  kind: 'title',
                  left: 60,
                  top: 40,
                  width: 600,
                  height: 80,
                  isTable: false,
                  text: '项目汇报',
                  fillColor: '#FFFFFF',
                  lineColor: '#3B3832',
                  lineWidthPt: 1.5,
                  fillTransparency: 0,
                },
                shapes: [
                  { index: 0, name: 'Title 1', shapeName: 'Title 1', kind: 'title', text: '项目汇报', isTable: false, left: 60, top: 40, width: 600, height: 80 },
                  { index: 1, name: 'Table 1', shapeName: 'Table 1', kind: 'table', text: '', isTable: true, rows: 3, cols: 3, left: 60, top: 150, width: 500, height: 180 },
                ],
              },
            }
          }
          return { success: true, docKind: 'writer', character: {}, paragraph: {}, selection: { inTable: true, cellName: 'A1' }, view: { revisionView: 'all' } }
        }
        return { success: true }
      },
    },
  }
  Object.assign(vm, component.data.call(vm), component.methods)
  for (const [k, fn] of Object.entries(component.computed)) {
    Object.defineProperty(vm, k, { get: () => fn.call(vm), configurable: true })
  }
  return vm
}

test('LibreOfficeEditor.vue：对 writer / calc / impress 均挂载 EditorToolbar 并传入 :doc-kind', () => {
  assert.ok(
    EDITOR_SRC.includes("(docKind === 'writer' || docKind === 'calc' || docKind === 'impress')"),
    'LibreOfficeEditor 应对 writer / calc / impress 挂载 EditorToolbar',
  )
  assert.ok(
    EDITOR_SRC.includes(':doc-kind="docKind"'),
    'LibreOfficeEditor 应将 docKind 传给 EditorToolbar',
  )
  assert.ok(
    TEMPLATE.includes('v-if="isCalc"') && TEMPLATE.includes('v-if="isImpress"'),
    'EditorToolbar 模板应包含 isCalc 与 isImpress 专属分支',
  )
  assert.ok(
    TEMPLATE.includes('etb-calc-bar'),
    'EditorToolbar 模板应包含 ElyOffice 风格 Calc 名称框与公式栏 (.etb-calc-bar)',
  )
})

test('Calc (Excel) 模式：公式栏、名称框、工作表切换与 ElyOffice PropertyGroup 卡片动作完整闭环', async () => {
  const vm = makeToolbarVm('calc')
  assert.equal(vm.isCalc, true)
  assert.equal(vm.isWriter, false)
  assert.equal(vm.isImpress, false)

  await vm.refresh()
  assert.equal(vm.calcAddressInput, 'B3')
  assert.equal(vm.calcFormulaInput, '=SUM(B1:B2)')

  // 名称框选区跳转
  vm.calls.length = 0
  vm.calcAddressInput = 'A1:C10'
  await vm.submitCalcAddress()
  assert.deepEqual(vm.calls[0], { action: 'sheet_select_range', params: { range: 'A1:C10' } })

  // 公式栏写入与取消
  vm.calls.length = 0
  vm.calcFormulaInput = '=AVERAGE(B1:B2)'
  await vm.submitCalcFormula()
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_write_cells',
    params: { startCell: 'B3', rows: [['=AVERAGE(B1:B2)']] },
  })
  vm.calcFormulaInput = '临时编辑'
  vm.cancelCalcFormula()
  assert.equal(vm.calcFormulaInput, '=SUM(B1:B2)')

  // 自动换行、合并单元格、垂直对齐、数字格式
  vm.calls.length = 0
  await vm.toggleCalcWrap()
  assert.deepEqual(vm.calls[0], { action: 'sheet_format_cells', params: { wrap: true } })

  vm.calls.length = 0
  await vm.toggleCalcMerge()
  assert.deepEqual(vm.calls[0], { action: 'sheet_merge_cells', params: { range: 'B3:D5', action: 'merge' } })

  vm.calls.length = 0
  await vm.applyCalcVAlign('top')
  assert.deepEqual(vm.calls[0], { action: 'sheet_format_cells', params: { vAlign: 'top' } })

  vm.calls.length = 0
  await vm.applyCalcNumberFormat('¥#,##0.00')
  assert.deepEqual(vm.calls[0], { action: 'sheet_format_cells', params: { numberFormat: '¥#,##0.00' } })

  // 单元格与行列卡片：边框、行列增删、自适应行高列宽
  vm.calls.length = 0
  await vm.applyCalcBorder('outer', 1.5)
  assert.deepEqual(vm.calls[0], { action: 'sheet_set_borders', params: { preset: 'outer', widthPt: 1.5 } })

  vm.calls.length = 0
  await vm.editCalcRowsCols('insert_rows', 'after')
  assert.deepEqual(vm.calls[0], { action: 'sheet_edit_rows_cols', params: { action: 'insert_rows', position: 'after', count: 1 } })

  vm.calls.length = 0
  await vm.autoFitCalc('cols')
  assert.deepEqual(vm.calls[0], { action: 'sheet_set_row_col', params: { autoFitCols: true } })

  // 数据卡片：排序、筛选、数据验证、条件格式、分组
  vm.calls.length = 0
  await vm.sortCalcRange(false)
  assert.deepEqual(vm.calls[0], { action: 'sheet_sort_range', params: { ascending: false, hasHeader: true } })

  vm.calls.length = 0
  await vm.toggleCalcAutoFilter()
  assert.deepEqual(vm.calls[0], { action: 'sheet_set_autofilter', params: { enabled: true } })

  vm.calls.length = 0
  vm.calcValForm.type = 'list'
  vm.calcValForm.list = '合规, 不合规, 待核查'
  await vm.applyCalcValidation()
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_set_data_validation',
    params: { type: 'list', list: ['合规', '不合规', '待核查'] },
  })

  vm.calls.length = 0
  vm.calcCondForm.operator = '>'
  vm.calcCondForm.value1 = '1000'
  await vm.applyCalcCondFormat('#FDECEC', '#C93B2B')
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_conditional_format',
    params: { operator: '>', value1: '1000', bgColor: '#FDECEC', fontColor: '#C93B2B' },
  })

  vm.calls.length = 0
  await vm.groupCalcRowsCols('group', 'rows')
  assert.deepEqual(vm.calls[0], { action: 'sheet_group_rows_cols', params: { action: 'group', orientation: 'rows' } })

  // 插入卡片：图表、批注、命名区域、数据透视表
  vm.calls.length = 0
  vm.calcChartForm = { type: 'line', range: 'A1:B12', title: '月度趋势' }
  await vm.insertCalcChart()
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_add_chart',
    params: { type: 'line', range: 'A1:B12', title: '月度趋势' },
  })

  vm.calls.length = 0
  vm.calcCommentText = '核对底稿第 3 页'
  await vm.saveCalcComment()
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_add_comment',
    params: { cell: 'B3', text: '核对底稿第 3 页' },
  })

  vm.calls.length = 0
  vm.calcNameForm = { name: 'RevenueRange', range: 'B2:B20' }
  await vm.defineCalcName()
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_define_name',
    params: { action: 'add', name: 'RevenueRange', range: 'B2:B20' },
  })

  // 工作表与视图卡片：切换/新建/重命名/冻结/网格线
  vm.calls.length = 0
  await vm.switchCalcSheet('负债表')
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_manage_sheets',
    params: { action: 'activate', name: '负债表' },
  })

  vm.calls.length = 0
  await vm.freezeCalcPanes(0, 1)
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_freeze_panes',
    params: { cols: 0, rows: 1 },
  })

  vm.calls.length = 0
  await vm.toggleCalcGridlines()
  assert.deepEqual(vm.calls[0], {
    action: 'set_view_options',
    params: { showGrid: false },
  })

  // 快捷函数按钮（Σ 求和 / 平均值）：选中区域 B3:D5 时直接生成 =SUM(B3:D5) 并写入当前格 B3
  vm.calls.length = 0
  await vm.insertCalcQuickFormula('SUM')
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_write_cells',
    params: { startCell: 'B3', rows: [['=SUM(B3:D5)']] },
  })

  // 新建工作表防重名：当已有 ['Sheet1', 'Sheet3'] 时，自动跳过已存在的 Sheet3 生成 Sheet4
  vm.state.calc.sheets = ['Sheet1', 'Sheet3']
  vm.calls.length = 0
  await vm.addCalcSheet()
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_manage_sheets',
    params: { action: 'add', name: 'Sheet4' },
  })

  // A1 单元格处点「冻结至当前行列」默认冻结首行首列 (1, 1) 而非取消冻结 (0, 0)
  vm.state.calc.col = 0
  vm.state.calc.row = 0
  vm.calls.length = 0
  await vm.freezeCalcAtCurrent()
  assert.deepEqual(vm.calls[0], {
    action: 'sheet_freeze_panes',
    params: { cols: 1, rows: 1 },
  })
})

test('Impress (PPT) 模式：幻灯片导航、版式/画幅、插入元素、形状与表格 PropertyGroup 卡片及演讲者备注闭环', async () => {
  const vm = makeToolbarVm('impress')
  assert.equal(vm.isImpress, true)
  assert.equal(vm.isWriter, false)
  assert.equal(vm.isCalc, false)

  await vm.refresh()
  assert.equal(vm.impressNotesInput, '本页演讲备注')
  assert.equal(vm.activeShapeName, 'Title 1')
  assert.equal(vm.impressHasTable, true)

  // 幻灯片翻页、增删、移动、版式与画幅
  vm.calls.length = 0
  await vm.prevSlide()
  assert.deepEqual(vm.calls[0], { action: 'slide_goto', params: { slideNumber: 1 } })

  vm.calls.length = 0
  await vm.nextSlide()
  assert.deepEqual(vm.calls[0], { action: 'slide_goto', params: { slideNumber: 3 } })

  vm.calls.length = 0
  await vm.addImpressSlide()
  assert.deepEqual(vm.calls[0], { action: 'slide_add_page', params: { position: 2, layout: 1 } })

  vm.calls.length = 0
  await vm.moveImpressSlideTo(4)
  assert.deepEqual(vm.calls[0], { action: 'slide_move_page', params: { slideNumber: 2, toPosition: 4 } })

  vm.calls.length = 0
  await vm.applyImpressLayout(20)
  assert.deepEqual(vm.calls[0], { action: 'slide_set_layout', params: { slideNumber: 2, layout: 20 } })

  vm.calls.length = 0
  await vm.applyImpressMaster('Corporate')
  assert.deepEqual(vm.calls[0], { action: 'slide_set_layout', params: { slideNumber: 2, masterName: 'Corporate' } })

  vm.calls.length = 0
  await vm.applyImpressSlideSize(280, 157.5)
  assert.deepEqual(vm.calls[0], {
    action: 'set_page_setup',
    params: { width: 280, height: 157.5, orientation: 'landscape' },
  })

  // 插入卡片：文本框、几何形状、表格、超链接
  vm.calls.length = 0
  await vm.insertImpressShape('triangle')
  assert.deepEqual(vm.calls[0], {
    action: 'slide_add_shape',
    params: { slideNumber: 2, shapeType: 'triangle', left: 120, top: 120, width: 180, height: 120 },
  })

  vm.calls.length = 0
  await vm.insertImpressTable(3, 4)
  assert.deepEqual(vm.calls[0], {
    action: 'slide_add_table',
    params: { slideNumber: 2, rows: 3, cols: 4, left: 60, top: 100, width: 480, height: 96 },
  })

  vm.calls.length = 0
  vm.linkUrl = 'https://example.com'
  await vm.applyImpressHyperlink()
  assert.deepEqual(vm.calls[0], {
    action: 'slide_set_hyperlink',
    params: { slideNumber: 2, shapeName: 'Title 1', searchText: '项目汇报', url: 'https://example.com' },
  })

  // 形状与排列卡片：填充/边框/透明度与几何尺寸、删除形状
  vm.calls.length = 0
  await vm.formatImpressShape({ fillColor: '#2E6BE6', fillTransparency: 20 })
  assert.deepEqual(vm.calls[0], {
    action: 'slide_format_shape',
    params: { slideNumber: 2, shapeName: 'Title 1', fillColor: '#2E6BE6', fillTransparency: 20 },
  })

  vm.calls.length = 0
  vm.shapeGeomForm = { left: 80, top: 50, width: 520, height: 90 }
  await vm.applyImpressShapeGeom()
  assert.deepEqual(vm.calls[0], {
    action: 'slide_set_shape_geometry',
    params: { slideNumber: 2, shapeName: 'Title 1', left: 80, top: 50, width: 520, height: 90 },
  })

  // 表格属性卡片与演讲者备注卡片
  vm.calls.length = 0
  await vm.styleImpressTable({ headerBold: true, borderWidthPt: 1 })
  assert.deepEqual(vm.calls[0], {
    action: 'slide_table_set_style',
    params: { slideNumber: 2, shapeName: 'Table 1', headerBold: true, borderWidthPt: 1 },
  })

  vm.calls.length = 0
  vm.impressNotesInput = '更新后的演讲者备注'
  await vm.saveImpressNotes()
  assert.deepEqual(vm.calls[0], {
    action: 'slide_write_notes',
    params: { slideNumber: 2, text: '更新后的演讲者备注' },
  })

  // 切换目标形状：同步选中画布形状 (slide_goto)，且顶栏 B / 字号操作自动带上 activeShapeName
  vm.calls.length = 0
  await vm.selectImpressShapeTarget(vm.impressState.shapes[1])
  assert.deepEqual(vm.calls[0], {
    action: 'slide_goto',
    params: { slideNumber: 2, shapeName: 'Table 1' },
  })
  assert.equal(vm.activeShapeName, 'Table 1')

  vm.calls.length = 0
  await vm.ui('bold')
  assert.deepEqual(vm.calls[0], {
    action: 'ui_command',
    params: { name: 'bold', shapeName: 'Table 1' },
  })

  // 形状文字直接修改与表格单元格内容写入
  await vm.selectImpressShapeTarget(vm.impressState.shapes[0])
  vm.calls.length = 0
  vm.impressShapeTextInput = '新标题内容'
  await vm.updateImpressShapeText()
  assert.deepEqual(vm.calls[0], {
    action: 'slide_set_shape_text',
    params: { slideNumber: 2, shapeName: 'Title 1', text: '新标题内容' },
  })

  vm.calls.length = 0
  vm.impressTableCellForm = { row: 2, col: 3, text: '达成率 98%' }
  await vm.setImpressTableCell()
  assert.deepEqual(vm.calls[0], {
    action: 'slide_table_set_cell',
    params: { slideNumber: 2, shapeName: 'Table 1', row: 1, col: 2, text: '达成率 98%' },
  })
})

test('Calc / Impress 查找与单步替换：replaceCurrent 走 find_replace(replaceAll:false)', async () => {
  const vm = makeToolbarVm('calc', (action) => {
    if (action === 'find_navigate') return { success: true, found: true, index: 1, total: 2 }
    if (action === 'find_replace') return { success: true, replaced: 1, total: 1 }
  })
  vm.findText = '旧词'
  vm.replaceText = '新词'
  vm.findIndex = 1
  await vm.replaceCurrent()
  assert.deepEqual(vm.calls[0], {
    action: 'find_replace',
    params: { findText: '旧词', replaceText: '新词', replaceAll: false, matchCase: false },
  })
})

test('office_thread.js：CHROME_URLS 覆盖 Calc/Impress 原生工具栏且 get_ui_state / set_zoom / set_view_options 支持非 Writer 文档', () => {
  assert.ok(WORKER_SRC.includes('private:resource/toolbar/calcobjectbar'), 'CHROME_URLS 应包含 calcobjectbar')
  assert.ok(WORKER_SRC.includes('private:resource/toolbar/inputbar'), 'CHROME_URLS 应包含 Calc 原生公式栏 inputbar')
  assert.ok(WORKER_SRC.includes('private:resource/toolbar/slideviewtoolbar'), 'CHROME_URLS 应包含 Impress slideviewtoolbar')
  assert.ok(WORKER_SRC.includes('function activeCalcSelection()'), 'office_thread.js 应提供 activeCalcSelection 辅助函数')
  assert.ok(WORKER_SRC.includes('function activeImpressContext('), 'office_thread.js 应提供 activeImpressContext 辅助函数')
  assert.ok(WORKER_SRC.includes('selRange.getIsMerged()'), 'activeCalcSelection 应真实读回 merged 状态')
  assert.ok(WORKER_SRC.includes('ctrl.hasFrozenPanes()'), 'activeCalcSelection 应真实读回 hasFrozenPanes 状态')
  assert.ok(WORKER_SRC.includes('sheet.isProtected()'), 'activeCalcSelection 应真实读回 protected 状态')
  assert.ok(WORKER_SRC.includes('scheduleNativeKeySelectionRefresh()'), 'postNativeKeys 后应延迟触发选区与公式栏状态刷新')
})

test('zh-CN 与 en-US 的 editor.toolbar 新增 Calc / Impress 国际化键集合严格对齐', () => {
  assert.deepEqual(Object.keys(zh.toolbar).sort(), Object.keys(en.toolbar).sort())
})
