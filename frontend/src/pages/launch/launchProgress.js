// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 启动页进度条：桌面端等本机后端的那几秒给一个有依据的进度。
//
// 依据是本机上一次实际启动用了多久（按页面加载起算，存在本机），首启没有记录时按 8 秒估。
// 曲线先快后慢、到预计时间约 87%，自己最多走到 95%；后端真正可达才由调用方置 100%。
// 机器变慢时不会提前「走满」再干等，变快时只是提前跳满。
//
// 零依赖纯函数（同 sidebarCollapse.js 的先例），`storage` 是 uni 的 getStorageSync/setStorageSync 子集。

export const LAUNCH_DURATION_STORAGE_KEY = 'awd_launch_duration_ms'
export const DEFAULT_LAUNCH_MS = 8000
const MIN_MS = 1000
const MAX_MS = 120000
export const PROGRESS_CAP = 0.95

/** 上次启动耗时（毫秒）；没有或不合理时退回缺省值。 */
export function loadExpectedLaunchMs(storage) {
  try {
    const saved = Number(storage.getStorageSync(LAUNCH_DURATION_STORAGE_KEY))
    return Number.isFinite(saved) && saved >= MIN_MS && saved <= MAX_MS ? saved : DEFAULT_LAUNCH_MS
  } catch (e) {
    return DEFAULT_LAUNCH_MS
  }
}

/** 记下这次启动耗时，供下次估算；超出合理范围的不记（比如中途休眠）。 */
export function saveLaunchMs(storage, ms) {
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) return
  try { storage.setStorageSync(LAUNCH_DURATION_STORAGE_KEY, Math.round(ms)) } catch (e) { /* 记不住只影响下次估算 */ }
}

/** 已等 elapsedMs、预计 expectedMs 时的进度（0–PROGRESS_CAP）。 */
export function launchProgress(elapsedMs, expectedMs) {
  if (!(elapsedMs > 0) || !(expectedMs > 0)) return 0
  return PROGRESS_CAP * (1 - Math.exp(-2.5 * elapsedMs / expectedMs))
}
