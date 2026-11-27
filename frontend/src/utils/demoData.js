// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X12: "fill demo data" buttons sit next to real actions in Settings (case intake, firm dashboard). A lawyer
// using the product must never see them; they are for developers, QA and marketing screenshots.
// Visible only in a development build, or when a developer opts in on this machine:
//   localStorage.setItem('awd.demoDataTools', '1')
// (marketing-screenshots seeds through the API directly and does not need the buttons).

export const DEMO_DATA_TOOLS_KEY = 'awd.demoDataTools'

export function demoDataToolsVisible({ env, storage } = {}) {
  const e = env || (typeof import.meta !== 'undefined' ? import.meta.env : null) || {}
  if (e.DEV === true || e.DEV === 'true' || e.MODE === 'development') return true
  try {
    const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
    return !!s && s.getItem(DEMO_DATA_TOOLS_KEY) === '1'
  } catch (err) {
    return false
  }
}
