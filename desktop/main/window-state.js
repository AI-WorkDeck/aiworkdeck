// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 主窗口大小 / 位置 / 最大化的记忆（问题 18）。记录落 prefs（~/.aiworkdeck/prefs.json）。
// 恢复前校验：标题栏那一条至少有一截落在某块显示器的工作区里，否则（例如外接屏拔了）
// 退回默认尺寸、不给坐标，交给系统居中。

const PREF_KEY = 'mainWindowStateV1'
const TITLE_STRIP = 42 // 顶栏高度，与 trafficLightPosition 的推算同源
const MIN_VISIBLE_WIDTH = 100

function validBounds(b) {
  return !!b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) && b.width > 0 && b.height > 0
}

function displayShowingTitleBar(bounds, displays) {
  for (const d of displays || []) {
    const wa = d && d.workArea
    if (!wa) continue
    const w = Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x)
    const h = Math.min(bounds.y + TITLE_STRIP, wa.y + wa.height) - Math.max(bounds.y, wa.y)
    if (w >= MIN_VISIBLE_WIDTH && h >= TITLE_STRIP / 2) return d
  }
  return null
}

function restoreWindowOptions(saved, displays, fallback) {
  const fallbackResult = { bounds: { width: fallback.width, height: fallback.height }, maximized: false }
  if (!validBounds(saved)) return fallbackResult
  const display = displayShowingTitleBar(saved, displays)
  if (!display) return fallbackResult
  const wa = display.workArea
  return {
    bounds: {
      x: Math.round(saved.x),
      y: Math.round(saved.y),
      width: Math.round(Math.min(saved.width, wa.width)),
      height: Math.round(Math.min(saved.height, wa.height)),
    },
    maximized: !!saved.maximized,
  }
}

function captureWindowState(win) {
  const maximized = win.isMaximized()
  const useNormal = maximized || win.isFullScreen() || win.isMinimized()
  const b = useNormal ? win.getNormalBounds() : win.getBounds()
  return { x: b.x, y: b.y, width: b.width, height: b.height, maximized }
}

module.exports = { PREF_KEY, restoreWindowOptions, captureWindowState }
