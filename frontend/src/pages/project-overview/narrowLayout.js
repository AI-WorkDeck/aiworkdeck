// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 窄窗口里面板给文档让路（Q28 / X-S10，firstday-1125 截图 23–25）。
//
// 规则在 panelWidthLimits.planPanels（纯函数，有单测）；这里只是接线：
//   - 窗口变窄：左栏先缩后收，再轮到 AI 面板；被「自动」收起的记一笔 autoCollapsed，
//     窗口变宽（带回差）时只把这些自动打开——用户自己关的面板永不自动打开；
//   - 放不下时用户主动打开一个面板（任何入口：顶栏开关、rail、菜单、「问 AI」）：
//     以浮层抽屉打开，压在文档上、不挤它；Esc、点文档（焦点进编辑器）或再点开关关掉；
//   - 自动收起不写入「左栏收起」的持久化偏好（那是用户的选择，不是窗口的）。
// 审阅面板本来就是编辑器里的浮层（LibreOfficeEditor .libre-review-overview），文档列
// 保住 480 之后它就不会再盖掉整份文档。
import { planPanels, openAsOverlay, TREE_MIN_WIDTH, AI_MIN_WIDTH } from './panelWidthLimits.js'

export const narrowLayoutMethods = {
  narrowLayoutGeometry() {
    const sidebar = this.$refs.sidebarLeft?.$el || this.$refs.sidebarLeft
    const layout = sidebar?.parentElement
    if (!layout?.clientWidth) return null
    const rail = layout.querySelector('.left-rail')
    return { layoutWidth: layout.clientWidth, railWidth: rail?.offsetWidth || 0 }
  },
  // 窗口尺寸变化时的让位规划（handleResponsiveResize 调）
  applyNarrowLayout(geometry) {
    const auto = this.panelAutoCollapsed
    const aiManaged = !this.isChatMode && !!this.hasProject
    const plan = planPanels({
      ...geometry,
      tree: { open: !this.sidebarCollapsed, width: this.sidebarWidth, auto: auto.tree, overlay: this.sidebarOverlay },
      ai: aiManaged ? { open: this.showAiPanel, width: this.aiPanelWidth, auto: auto.ai, overlay: this.aiPanelOverlay } : null,
    })
    this.narrowLayoutApplying = true
    if (this.sidebarOverlay) {
      // 浮层打开着、窗口又放得下了：落回停靠
      if (!openAsOverlay({ ...geometry, otherWidth: this.showAiPanel && !this.aiPanelOverlay ? this.aiPanelWidth : 0, min: Math.min(this.sidebarWidth, TREE_MIN_WIDTH) })) this.sidebarOverlay = false
    } else {
      this.narrowWidthCap.tree = plan.tree.open && plan.tree.width < this.sidebarWidth ? plan.tree.width : 0
      if (this.sidebarCollapsed === plan.tree.open) this.sidebarCollapsed = !plan.tree.open
      auto.tree = plan.tree.auto
    }
    if (aiManaged) {
      if (this.aiPanelOverlay) {
        if (!openAsOverlay({ ...geometry, otherWidth: this.sidebarCollapsed || this.sidebarOverlay ? 0 : this.sidebarWidth, min: Math.min(this.aiPanelWidth, AI_MIN_WIDTH) })) this.aiPanelOverlay = false
      } else {
        this.narrowWidthCap.ai = plan.ai.open && plan.ai.width < this.aiPanelWidth ? plan.ai.width : 0
        if (this.showAiPanel !== plan.ai.open) {
          this.showAiPanel = plan.ai.open
          if (plan.ai.open) this.aiPanelMounted = true
        }
        auto.ai = plan.ai.auto
      }
    }
    this.$nextTick(() => { this.narrowLayoutApplying = false })
  },
  // 面板被打开（任何入口）：放得下照常停靠；放不下就作浮层抽屉。自动展开不走这里。
  onPanelOpened(which, open) {
    if (this.narrowLayoutApplying) return
    if (which === 'tree') this.panelAutoCollapsed.tree = false
    else this.panelAutoCollapsed.ai = false
    if (!open) {
      if (which === 'tree') this.sidebarOverlay = false
      else this.aiPanelOverlay = false
      return
    }
    if (which === 'ai' && (this.isChatMode || !this.hasProject)) return
    const geometry = this.narrowLayoutGeometry()
    if (!geometry) return
    const overlay = which === 'tree'
      ? openAsOverlay({ ...geometry, otherWidth: this.showAiPanel && !this.aiPanelOverlay ? this.aiPanelWidth : 0, min: Math.min(this.sidebarWidth, TREE_MIN_WIDTH) })
      : openAsOverlay({ ...geometry, otherWidth: this.sidebarCollapsed || this.sidebarOverlay ? 0 : this.sidebarWidth, min: Math.min(this.aiPanelWidth, AI_MIN_WIDTH) })
    if (which === 'tree') {
      this.sidebarOverlay = overlay
      // 同时只开一个抽屉
      if (overlay && this.aiPanelOverlay) { this.narrowLayoutApplying = true; this.showAiPanel = false; this.aiPanelOverlay = false; this.$nextTick(() => { this.narrowLayoutApplying = false }) }
    } else {
      this.aiPanelOverlay = overlay
      if (overlay && this.sidebarOverlay) { this.narrowLayoutApplying = true; this.sidebarCollapsed = true; this.sidebarOverlay = false; this.$nextTick(() => { this.narrowLayoutApplying = false }) }
    }
  },
  closePanelOverlays() {
    if (this.sidebarOverlay) { this.sidebarCollapsed = true; this.sidebarOverlay = false }
    if (this.aiPanelOverlay) { this.showAiPanel = false; this.aiPanelOverlay = false }
  },
  setupPanelOverlayDismiss() {
    if (typeof window === 'undefined' || this._overlayDismiss) return
    const hasOverlay = () => this.sidebarOverlay || this.aiPanelOverlay
    const onKey = (e) => { if (e.key === 'Escape' && hasOverlay()) this.closePanelOverlays() }
    // 点文档：编辑器在 iframe/webview 里，点击不会冒泡上来，焦点进去时窗口收到 blur
    const onBlur = () => {
      if (!hasOverlay()) return
      setTimeout(() => {
        const el = document.activeElement
        if (el && /^(IFRAME|WEBVIEW)$/.test(el.tagName) && el.closest && el.closest('.workbench')) this.closePanelOverlays()
      }, 0)
    }
    // 点在抽屉外的工作区（标签栏、文档外框）
    const onDown = (e) => {
      if (!hasOverlay()) return
      const t = e.target
      if (!t || !t.closest) return
      if (t.closest('.sidebar-left.as-overlay, .side-panel-ai.as-overlay, .left-rail, .project-header')) return
      if (t.closest('.workbench')) this.closePanelOverlays()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('mousedown', onDown, true)
    this._overlayDismiss = () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('mousedown', onDown, true)
      this._overlayDismiss = null
    }
  },
}
