// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const SCAN_ON_EXIT_KEY = 'awd_scan_projects_on_exit'

export function shouldScanProjectsOnExit(storage = globalThis.uni) {
  try { return storage?.getStorageSync(SCAN_ON_EXIT_KEY) !== '0' } catch { return true }
}

export function setScanProjectsOnExit(enabled, storage = globalThis.uni) {
  storage?.setStorageSync(SCAN_ON_EXIT_KEY, enabled ? '1' : '0')
}
