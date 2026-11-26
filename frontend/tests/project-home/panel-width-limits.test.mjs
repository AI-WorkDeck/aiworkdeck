// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 面板拖拽上限必须按面板所在的容器算，不能按整窗宽算（dev-board#459）。
//
// 病灶：applyResizeFrame 用 `Math.floor(window.innerWidth * 0.75)` 当左右两侧面板的
// 拖拽上限，可是 .side-panel-ai 的父容器 .workbench-main 只拿到「整窗 − 50px rail −
// 左栏宽」。.side-panel{flex-shrink:0} 让面板不肯让宽，.workbench{overflow:hidden} 又
// 把溢出裁掉——于是编辑区先塌成 0，随后 AI 面板右半边被裁在窗口右缘之外（输入框/发送
// 键看不见也点不着），看上去就像「窗口被撑出屏幕」。把窗口放大（窗口→缩放）会让
// .workbench 变宽、裁切消失，正是复测者找到的恢复手法。
//
// 左栏那支是同一个缺陷的镜像：拖宽左栏同样能把 AI 面板顶出容器。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  EDITOR_MIN_WIDTH,
  rightPanelMaxWidth,
  leftPanelMaxWidth
} from '../../src/pages/project-overview/panelWidthLimits.js'

const DRAG = readFileSync(
  new URL('../../src/pages/project-overview/tabDragSplit.js', import.meta.url), 'utf8')

const RIGHT_MIN = 240
const LEFT_MIN = 160

test('右侧面板：上限 + 编辑区下限不超过容器宽（容器不够时退回 min）', () => {
  for (const containerWidth of [320, 420, 440, 600, 930, 1090, 1350, 1870]) {
    const max = rightPanelMaxWidth(containerWidth, RIGHT_MIN)
    if (max + EDITOR_MIN_WIDTH > containerWidth) {
      // 唯一允许溢出的情形：容器连 min + 编辑区下限都装不下，此时只能退回 min
      assert.equal(max, RIGHT_MIN,
        `容器 ${containerWidth}：装不下时只允许退回 min，实得 ${max}`)
      assert.ok(containerWidth < RIGHT_MIN + EDITOR_MIN_WIDTH,
        `容器 ${containerWidth} 明明装得下，不该走兜底`)
    }
  }
})

test('左侧栏：rail + 左栏上限 + AI 面板 + 编辑区下限不超过整条主布局宽', () => {
  const rail = 50
  for (const layoutWidth of [1000, 1280, 1400, 1920]) {
    for (const aiPanelWidth of [0, 360, 700, 1050]) {
      const max = leftPanelMaxWidth(layoutWidth, rail, aiPanelWidth, LEFT_MIN)
      if (max === LEFT_MIN) continue
      assert.ok(rail + max + aiPanelWidth + EDITOR_MIN_WIDTH <= layoutWidth,
        `布局 ${layoutWidth} / AI ${aiPanelWidth}：左栏上限 ${max} 溢出`)
    }
  }
})

test('可用宽度不足时退回 min（宁可遮挡，也不给出负数/0 宽的上限）', () => {
  assert.equal(rightPanelMaxWidth(300, RIGHT_MIN), RIGHT_MIN)
  assert.equal(rightPanelMaxWidth(0, RIGHT_MIN), RIGHT_MIN)
  assert.equal(leftPanelMaxWidth(600, 50, 500, LEFT_MIN), LEFT_MIN)
  assert.equal(leftPanelMaxWidth(0, 0, 0, LEFT_MIN), LEFT_MIN)
})

test('病灶定点：1400px 窗口 + 420px 左栏，AI 面板上限不再是 1050', () => {
  // .workbench-main 实测宽 = 1400 − 50 rail − 420 左栏 = 930
  const container = 930
  const oldFormula = Math.max(RIGHT_MIN, Math.floor(1400 * 0.75)) // 现行公式
  assert.equal(oldFormula, 1050, '现行公式确实给出会溢出容器的 1050')
  const max = rightPanelMaxWidth(container, RIGHT_MIN)
  assert.ok(max <= 730, `新上限应 ≤ 730（930 − 200），实得 ${max}`)
  assert.ok(max < oldFormula)
})

test('非法/缺失入参不炸，且不会给出比 min 还小的上限', () => {
  assert.equal(rightPanelMaxWidth(undefined, RIGHT_MIN), RIGHT_MIN)
  assert.equal(rightPanelMaxWidth(NaN, RIGHT_MIN), RIGHT_MIN)
  assert.equal(rightPanelMaxWidth(-500, RIGHT_MIN), RIGHT_MIN)
  assert.equal(leftPanelMaxWidth(NaN, NaN, NaN, LEFT_MIN), LEFT_MIN)
})

test('接线：tabDragSplit 真的改用了这个模块，且两支都不再按整窗宽算', () => {
  assert.match(DRAG, /from\s+'\.\/panelWidthLimits\.js'/,
    'tabDragSplit.js 必须 import panelWidthLimits')
  assert.ok(!/vw\s*\*\s*0\.75/.test(DRAG),
    '左右两支的 `vw * 0.75` 都要换掉——只改右支的话，拖宽左栏能把同一个症状换个入口复现')
  assert.match(DRAG, /rightPanelMaxWidth\(/, '右支要用容器感知的上限')
  assert.match(DRAG, /leftPanelMaxWidth\(/, '左支要用容器感知的上限')
})

test('接线：容器几何在 startResize 里实测，不硬编码 rail 宽等常量', () => {
  const body = DRAG.slice(DRAG.indexOf('startResize(target, evt)'), DRAG.indexOf('onResizeMove(evt)'))
  assert.ok(body.length > 0, '截不到 startResize 函数体')
  assert.match(body, /parentElement/, '容器宽要从面板的父元素实测（边框、紧凑模式都会让常量漂）')
  assert.match(body, /clientWidth/, '要读实际渲染宽度')
  assert.match(body, /containerWidth/, '量到的宽度要缓存到 this.resizing 上给 applyResizeFrame 用')
})

// ---- Q28 / X-S10：窄窗口里面板给文档让路 ----
import { planPanels, openAsOverlay, TREE_MIN_WIDTH, AI_MIN_WIDTH, REOPEN_HYSTERESIS } from '../../src/pages/project-overview/panelWidthLimits.js'
import { narrowLayoutMethods } from '../../src/pages/project-overview/narrowLayout.js'

const RAIL = 56
const open = (width) => ({ open: true, width, auto: false })
const docOf = (layoutWidth, plan) => layoutWidth - RAIL - plan.tree.width - plan.ai.width

test('文档列恒 ≥ 480：让位顺序是左栏缩、左栏收、AI 缩、AI 收', () => {
  const at = (w) => planPanels({ layoutWidth: w, railWidth: RAIL, tree: open(260), ai: open(360) })
  let p = at(1476)
  assert.deepEqual([p.tree.width, p.ai.width], [260, 360], '宽窗：用户宽原样')
  p = at(1150)
  assert.ok(p.tree.width < 260 && p.tree.width >= TREE_MIN_WIDTH && p.ai.width === 360, '先缩左栏：' + JSON.stringify(p))
  p = at(1000)
  assert.equal(p.tree.open, false); assert.equal(p.tree.auto, true, '左栏自动收起')
  assert.equal(p.ai.width, 360)
  p = at(960)
  assert.deepEqual([p.tree.open, p.ai.open, p.ai.width], [false, true, 360], '960：rail + AI + 544 文档（截图 23 的窗口）')
  assert.equal(docOf(960, p), 544)
  p = at(820)
  assert.equal(p.ai.open, false); assert.equal(p.ai.auto, true, '再窄 AI 也收起：rail + 文档')
  for (const w of [1476, 1300, 1150, 1036, 1000, 960, 900, 860, 836, 800]) {
    const q = at(w)
    if (q.tree.open || q.ai.open) assert.ok(docOf(w, q) >= EDITOR_MIN_WIDTH, w + ' 文档只剩 ' + docOf(w, q))
  }
})

test('回差：自动收起的面板要多出 24px 才回来；用户自己关的永不自动打开', () => {
  // 960 时左栏已被自动收起；窗口拉到刚够停靠 200 宽左栏的宽度还不回来，多 24 才回来
  const edge = RAIL + TREE_MIN_WIDTH + 360 + EDITOR_MIN_WIDTH
  const auto = { open: false, width: 260, auto: true }
  assert.equal(planPanels({ layoutWidth: edge, railWidth: RAIL, tree: auto, ai: open(360) }).tree.open, false)
  assert.equal(planPanels({ layoutWidth: edge + REOPEN_HYSTERESIS, railWidth: RAIL, tree: auto, ai: open(360) }).tree.open, true)
  const userClosed = { open: false, width: 260, auto: false }
  const wide = planPanels({ layoutWidth: 1920, railWidth: RAIL, tree: userClosed, ai: open(360) })
  assert.deepEqual(wide.tree, { open: false, width: 0, auto: false })
})

test('浮层抽屉不占文档宽、规划不动它；放不下才作浮层', () => {
  const p = planPanels({ layoutWidth: 800, railWidth: RAIL, tree: { open: true, width: 260, overlay: true }, ai: { open: false, width: 360, auto: true } })
  assert.equal(p.tree.open, true); assert.equal(p.ai.open, false)
  assert.equal(openAsOverlay({ layoutWidth: 800, railWidth: RAIL, otherWidth: 0, min: AI_MIN_WIDTH }), true)
  assert.equal(openAsOverlay({ layoutWidth: 1440, railWidth: RAIL, otherWidth: 260, min: AI_MIN_WIDTH }), false)
})

function fakeVm(overrides) {
  const vm = {
    narrowWidthCap: { tree: 0, ai: 0 },
    sidebarCollapsed: false, sidebarWidth: 260, showAiPanel: true, aiPanelWidth: 360, aiPanelMounted: true,
    sidebarOverlay: false, aiPanelOverlay: false, panelAutoCollapsed: { tree: false, ai: false },
    narrowLayoutApplying: false, isChatMode: false, hasProject: true,
    $nextTick(fn) { fn() }, ...overrides,
  }
  for (const [k, fn] of Object.entries(narrowLayoutMethods)) vm[k] = fn.bind(vm)
  return vm
}

test('接线：截图临时 1px → 恢复 1440，左栏与 AI 面板自动回来、宽度不变', () => {
  const vm = fakeVm()
  vm.applyNarrowLayout({ layoutWidth: 1, railWidth: RAIL })
  assert.deepEqual([vm.sidebarCollapsed, vm.showAiPanel], [true, false])
  vm.applyNarrowLayout({ layoutWidth: 1440, railWidth: RAIL })
  assert.deepEqual([vm.sidebarCollapsed, vm.showAiPanel, vm.sidebarWidth, vm.aiPanelWidth], [false, true, 260, 360])
  assert.deepEqual(vm.narrowWidthCap, { tree: 0, ai: 0 })
})

test('接线：窄窗只限显示宽，用户宽不丢；窗口变宽后原样还原', () => {
  const vm = fakeVm()
  vm.applyNarrowLayout({ layoutWidth: 1150, railWidth: RAIL })
  assert.ok(vm.narrowWidthCap.tree > 0 && vm.narrowWidthCap.tree < 260, JSON.stringify(vm.narrowWidthCap))
  assert.equal(vm.sidebarWidth, 260)
  vm.applyNarrowLayout({ layoutWidth: 1600, railWidth: RAIL })
  assert.deepEqual(vm.narrowWidthCap, { tree: 0, ai: 0 })
})

test('AI 以浮层开着时，自动收起的左栏不会挤回来', () => {
  const p = planPanels({ layoutWidth: 800, railWidth: RAIL, tree: { open: false, width: 260, auto: true }, ai: { open: true, width: 360, overlay: true } })
  assert.equal(p.tree.open, false)
  assert.equal(p.ai.open, true)
})

test('接线：放不下时用户打开 AI 面板 → 浮层；窗口放宽后落回停靠；Esc 关闭', () => {
  const vm = fakeVm({ showAiPanel: false, sidebarCollapsed: true })
  vm.narrowLayoutGeometry = () => ({ layoutWidth: 800, railWidth: RAIL })
  vm.showAiPanel = true
  vm.onPanelOpened('ai', true)
  assert.equal(vm.aiPanelOverlay, true)
  vm.applyNarrowLayout({ layoutWidth: 800, railWidth: RAIL })
  assert.equal(vm.showAiPanel, true, '浮层不被窄窗规划收掉')
  vm.applyNarrowLayout({ layoutWidth: 1440, railWidth: RAIL })
  assert.equal(vm.aiPanelOverlay, false, '放得下了，落回停靠')
  vm.aiPanelOverlay = true
  vm.closePanelOverlays()
  assert.deepEqual([vm.showAiPanel, vm.aiPanelOverlay], [false, false])
})

test('接线：用户手动关掉的面板，窗口再宽也不自动打开', () => {
  const vm = fakeVm()
  vm.applyNarrowLayout({ layoutWidth: 900, railWidth: RAIL })
  assert.equal(vm.sidebarCollapsed, true)
  vm.sidebarCollapsed = false; vm.onPanelOpened('tree', false)   // 用户点开又关
  vm.sidebarCollapsed = true; vm.onPanelOpened('tree', false)
  vm.applyNarrowLayout({ layoutWidth: 1920, railWidth: RAIL })
  assert.equal(vm.sidebarCollapsed, true)
})
