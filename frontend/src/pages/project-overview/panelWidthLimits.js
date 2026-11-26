// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 左右两侧面板的拖拽上限（dev-board#459）。
//
// 病灶：applyResizeFrame 原来按 `window.innerWidth * 0.75` 限宽，可是面板并不住在整窗
// 里——.side-panel-ai 的父容器 .workbench-main 只拿到「整窗 − rail − 左栏」。
// .side-panel{flex-shrink:0} 让面板不肯让宽，.workbench{overflow:hidden} 又把溢出裁掉：
// 编辑区先塌成 0，接着面板右半边被裁在窗口右缘之外（输入框/发送键看不见也点不着），
// 看上去就像窗口被撑出了屏幕。左栏那支是同一个缺陷的镜像。
//
// 修法是「按实测容器宽算」而不是「按整窗宽推算」：容器宽在 startResize 里从面板的
// 父元素量一次（见 tabDragSplit.js）。这里刻意不写 rail 宽、边框宽这类常量——边框、
// 紧凑模式、右侧 dock（dev-board#180）都会让常量漂。
//
// 窗口变窄或恢复旧布局时也回夹面板（2026-09-07 实测 C2/C7）。
//
// 零依赖纯函数、只收数值参数，好在 node:test 里真跑一遍（同目录 flushDirtyEditors.js
// 的先例：本目录其余模块都 import 了 @/ 别名，node 直接 import 不动）。

// 编辑区最小可用宽度（Q28 / X-S10）：文档是正事，面板给文档让路。480 ≈ 100% 缩放下一行
// 26 个汉字，读得了一条条款、看得见修订上下文。原来是 200——960 宽窗口里审阅面板一开，
// 文档直接没了（firstday-1125 截图 23）。
export const EDITOR_MIN_WIDTH = 480
// 面板自己的最小宽：左栏（文件树）200；AI 面板 300（输入框、模型 chip、发送键一行放得下）。
export const TREE_MIN_WIDTH = 200
export const AI_MIN_WIDTH = 300
// 自动收起的面板要多出这么宽才自动展开，窗口边缘停在阈值附近时不闪。
export const REOPEN_HYSTERESIS = 24

const px = (v) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 右侧 AI 面板的拖拽上限。
 * @param {number} containerWidth 面板父容器（.workbench-main）的实测 clientWidth
 * @param {number} min            面板自身的最小宽（不足时的兜底返回值）
 */
export function rightPanelMaxWidth(containerWidth, min = 240) {
  const floor = px(min)
  return Math.max(floor, px(containerWidth) - EDITOR_MIN_WIDTH)
}

/**
 * 左栏的拖拽上限：整条主布局宽里还坐着 rail 与右侧 AI 面板。
 * @param {number} layoutWidth   左栏父容器（.main-layout）的实测 clientWidth
 * @param {number} railWidth     rail 的实测宽（隐藏/不存在时传 0）
 * @param {number} aiPanelWidth  右侧面板当前实测宽（收起时传 0）
 * @param {number} min           左栏自身的最小宽
 */
export function leftPanelMaxWidth(layoutWidth, railWidth, aiPanelWidth, min = 160) {
  const floor = px(min)
  const avail = px(layoutWidth) - px(railWidth) - px(aiPanelWidth)
  return Math.max(floor, avail - EDITOR_MIN_WIDTH)
}

/**
 * 窄窗口的面板让位规划（Q28 / X-S10）。文档列 = 主布局 − rail − 左栏 − AI 面板，必须 ≥
 * EDITOR_MIN_WIDTH；不够时按序让位：左栏缩到 200 → 左栏收起 → AI 面板缩到 300 → AI 面板收起。
 * （审阅面板在编辑器里自己改成浮层，见 LibreOfficeEditor 的 reviewOverlay，不进这里。）
 *
 * 每个面板的入参 { open, width, auto, overlay }：
 *   open    此刻展开（停靠或浮层）；
 *   width   用户宽（拖出来的宽，规划只决定显示宽，不改它）；
 *   auto    由本规划自动收起的（只有这种才会在窗口变宽后自动展开；用户自己关的永不自动打开）；
 *   overlay 用户在放不下时手动打开的浮层抽屉：不占文档宽，规划不动它。
 * 返回 { tree, ai }，各为 { open, width, auto }：width 为显示宽（收起时 0）。
 */
export function planPanels({ layoutWidth, railWidth, tree, ai }) {
  const avail = Math.max(0, px(layoutWidth) - px(railWidth))
  const wants = (p) => !!p && !p.overlay && (p.open || p.auto)
  let t = wants(tree) ? Math.max(TREE_MIN_WIDTH, px(tree.width)) : 0
  // AI 面板以浮层开着时仍占着优先级：左栏只有在 AI 能以最小宽停靠的前提下才回来，
  // 否则用户一打开 AI 浮层，自动收起的左栏反倒挤了回来。
  let a = wants(ai) ? Math.max(AI_MIN_WIDTH, px(ai.width)) : (ai && ai.overlay ? AI_MIN_WIDTH : 0)
  // 自动收起着的面板要回来，得多留出回差，否则在阈值上来回闪。
  const need = (p) => EDITOR_MIN_WIDTH + (p && p.auto && !p.open ? REOPEN_HYSTERESIS : 0)
  const docWith = () => avail - t - a
  // 1. 左栏缩到最小宽
  if (t && docWith() < need(tree)) t = Math.max(TREE_MIN_WIDTH, t - (need(tree) - docWith()))
  // 2. 左栏收起
  if (t && docWith() < need(tree)) t = 0
  // 3. AI 面板缩到最小宽
  if (a && docWith() < need(ai)) a = Math.max(AI_MIN_WIDTH, a - (need(ai) - docWith()))
  // 4. AI 面板收起；它都收了，左栏要是还在（回差内）也一并让出
  if (a && docWith() < need(ai)) a = ai && ai.overlay ? a : 0
  if (t && docWith() < need(tree)) t = 0
  const result = (p, w, wanted) => {
    if (p && p.overlay) return { open: true, width: px(p.width), auto: false }
    if (!wanted) return { open: false, width: 0, auto: false }
    return w ? { open: true, width: w, auto: false } : { open: false, width: 0, auto: true }
  }
  return { tree: result(tree, t, wants(tree)), ai: result(ai, a, wants(ai)) }
}

/** 用户在放不下时打开一个面板：放得下就停靠，放不下就以浮层抽屉打开（不挤文档）。 */
export function openAsOverlay({ layoutWidth, railWidth, otherWidth, min }) {
  return px(layoutWidth) - px(railWidth) - px(otherWidth) - px(min) < EDITOR_MIN_WIDTH
}
