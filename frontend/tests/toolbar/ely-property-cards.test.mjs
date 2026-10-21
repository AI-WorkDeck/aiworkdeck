// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#1377：编辑器工具栏融合 ElyOffice PropertyGroup 设计并移除丑陋原生菜单开关。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CN_FONT_SIZES, PT_FONT_SIZES } from '../../src/utils/paragraphFormat.js'
import zh from '../../src/locales/zh-CN/editor.js'
import en from '../../src/locales/en-US/editor.js'

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

function makeToolbarVm(customHandler) {
  const component = loadToolbarComponent()
  const calls = []
  const emitted = []
  const vm = {
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
          return { success: true, character: {}, paragraph: {}, selection: { inTable: true, cellName: 'A1' }, view: { revisionView: 'all' } }
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

test('顶栏模板移除「原生菜单」按钮，但保留内部 reapplyChrome / applyChrome 契约', async () => {
  assert.equal(TEMPLATE.includes('toggleChrome'), false, '顶栏模板中不应再渲染原生菜单按钮')
  assert.equal(TEMPLATE.includes('editor.toolbar.nativeMenus'), false, '顶栏模板中不应再出现原生菜单文案绑定')
  const vm = makeToolbarVm()
  assert.equal(vm.chromeHidden, true)
  await vm.reapplyChrome()
  assert.deepEqual(vm.calls[0], {
    action: 'set_chrome',
    params: { menubar: false, statusbar: false, toolbars: false },
  })
})

test('页面 ⌄ PropertyGroup 卡片：回读当前页面设置并派发方向、纸张大小与厘米页边距', async () => {
  const vm = makeToolbarVm((action, params) => {
    if (action === 'get_formatting') {
      return {
        success: true,
        page: {
          pageStyle: 'Standard',
          width: 297,
          height: 210,
          landscape: true,
          margins: { top: 37, bottom: 35, left: 28, right: 26 },
        },
      }
    }
    if (action === 'set_page_setup') {
      return {
        success: true,
        applied: params,
        page: {
          width: params.width || 210,
          height: params.height || 297,
          landscape: params.orientation === 'landscape',
          margins: params.margins || { top: 37, bottom: 35, left: 28, right: 26 },
        },
      }
    }
  })

  vm.openPageMenu()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(vm.menu, 'page')
  assert.equal(vm.pageForm.orientation, 'landscape')
  assert.equal(vm.pageForm.paper, 'A4')
  assert.equal(vm.pageForm.topCm, 3.7)
  assert.equal(vm.pageForm.leftCm, 2.8)

  vm.calls.length = 0
  await vm.applyPageOrientation('portrait')
  assert.deepEqual(vm.calls[0], {
    action: 'set_page_setup',
    params: { orientation: 'portrait' },
  })
  assert.equal(vm.pageForm.orientation, 'portrait')

  vm.calls.length = 0
  await vm.applyPaperSize({ k: 'A3', label: 'A3', width: 297, height: 420 })
  assert.deepEqual(vm.calls[0], {
    action: 'set_page_setup',
    params: { width: 297, height: 420, orientation: 'portrait' },
  })

  vm.calls.length = 0
  await vm.useMarginPreset({ k: 'official', top: 3.7, bottom: 3.5, left: 2.8, right: 2.6 })
  assert.deepEqual(vm.calls[0], {
    action: 'set_page_setup',
    params: { margins: { top: 37, bottom: 35, left: 28, right: 26 } },
  })
})

test('插入 ⌄ 菜单：支持插入目录（TOC）与页码并收起下拉', async () => {
  const vm = makeToolbarVm()
  vm.menu = 'insert'
  vm.startToc()
  assert.equal(vm.insertMode, 'toc')
  assert.equal(vm.tocForm.title, zh.toolbar.tocDefaultTitle)
  vm.tocForm.levels = 4
  vm.tocForm.position = 'start'
  await vm.doInsertToc()
  assert.deepEqual(vm.calls[0], {
    action: 'insert_toc',
    params: { title: zh.toolbar.tocDefaultTitle, levels: 4, position: 'start' },
  })
  assert.equal(vm.menu, '')

  vm.calls.length = 0
  vm.menu = 'insert'
  vm.startPageNumber()
  assert.equal(vm.insertMode, 'pageNumber')
  vm.pageNumForm.target = 'footer'
  vm.pageNumForm.align = 'right'
  vm.pageNumForm.pattern = '{PAGE} / {NUMPAGES}'
  await vm.doInsertPageNumber()
  assert.deepEqual(vm.calls[0], {
    action: 'edit_header_footer',
    params: { target: 'footer', align: 'right', pageNumberPattern: '{PAGE} / {NUMPAGES}' },
  })
  assert.equal(vm.menu, '')
})

test('表格 ⌄ PropertyGroup 卡片：支持三线表/全边框/无边框、表头底纹、垂直对齐与跨页表头', async () => {
  const vm = makeToolbarVm((action) => {
    if (action === 'get_formatting') {
      return {
        success: true,
        table: { name: 'Table1', rows: 3, cols: 3, cell: 'A1', repeatHeader: true, headerFill: '#e3efea' },
      }
    }
  })

  vm.openTableMenu()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(vm.menu, 'table')
  assert.equal(vm.tableForm.repeatHeader, true)
  assert.equal(vm.tableForm.headerFill, '#e3efea')

  vm.calls.length = 0
  await vm.applyTableFormat({ borderPreset: 'threeLine' })
  assert.deepEqual(vm.calls[0], {
    action: 'format_table',
    params: { borderPreset: 'threeLine', outsideBorderWidthPt: 1.5, insideBorderWidthPt: 0.75 },
  })

  vm.calls.length = 0
  await vm.applyTableFormat({ headerFill: '#F1F3F5' })
  assert.deepEqual(vm.calls[0], {
    action: 'format_table',
    params: { headerFill: '#F1F3F5' },
  })

  vm.calls.length = 0
  await vm.applyTableFormat({ repeatHeader: false })
  assert.deepEqual(vm.calls[0], {
    action: 'format_table',
    params: { repeatHeader: false },
  })
})

test('worker applyTableBorders：三线表设置顶底 1.5pt + 首行底边 0.75pt，切回全边框/无边框时清理首行残留边框', () => {
  const start = WORKER_SRC.indexOf('function applyTableBorders(table, spec)')
  const end = WORKER_SRC.indexOf('function styleTableStandard(table, opts)')
  const fnBody = WORKER_SRC.slice(start, end)
  const applyTableBorders = new Function(
    'HOUSE', 'css', 'borderLineStyle', 'ptToMm100',
    fnBody + '\nreturn applyTableBorders;',
  )(
    { tableBorder: { outsideMm: 26, insideMm: 18, color: 0, style: 'single' } },
    {
      table: {
        BorderLineStyle: { NONE: 0, SOLID: 1 },
        BorderLine2: function (o) { Object.assign(this, o) },
        TableBorder2: function (o) { Object.assign(this, o) },
      },
    },
    () => 1,
    (pt) => Math.round(Number(pt) * 2540 / 72),
  )

  const cellProps = { A1: {}, B1: {}, A2: {}, B2: {} }
  let tableBorder2 = null
  const mockTable = {
    getCellNames: () => ['A1', 'B1', 'A2', 'B2'],
    getCellByName: (name) => ({
      setPropertyValue: (k, v) => { cellProps[name][k] = v },
    }),
    setPropertyValue: (k, v) => { if (k === 'TableBorder2') tableBorder2 = v },
  }

  applyTableBorders(mockTable, { preset: 'threeLine', outsideMm: 53, insideMm: 26 })
  assert.equal(tableBorder2.TopLine.LineWidth, 53)
  assert.equal(tableBorder2.BottomLine.LineWidth, 53)
  assert.equal(tableBorder2.LeftLine.LineWidth, 0)
  assert.equal(tableBorder2.RightLine.LineWidth, 0)
  assert.equal(tableBorder2.HorizontalLine.LineWidth, 0)
  assert.equal(tableBorder2.VerticalLine.LineWidth, 0)
  assert.equal(cellProps.A1.BottomBorder.LineWidth, 26)
  assert.equal(cellProps.B1.BottomBorder.LineWidth, 26)
  assert.equal(cellProps.A2.BottomBorder, undefined)

  // 切回无边框时首行 BottomBorder 必须被归零，不留三线表残影
  applyTableBorders(mockTable, { preset: 'none' })
  assert.equal(tableBorder2.TopLine.LineWidth, 0)
  assert.equal(tableBorder2.BottomLine.LineWidth, 0)
  assert.equal(cellProps.A1.BottomBorder.LineWidth, 0)
  assert.equal(cellProps.B1.BottomBorder.LineWidth, 0)
})

test('zh-CN 与 en-US 的 editor.toolbar / editor.format 键集合严格对齐', () => {
  assert.deepEqual(Object.keys(zh.toolbar).sort(), Object.keys(en.toolbar).sort())
  assert.deepEqual(Object.keys(zh.format).sort(), Object.keys(en.format).sort())
})
