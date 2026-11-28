// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * C34 leftover (dev-board#1868): call onRecovered once each time the desktop's local service comes back
 * (down → healthy). Same rule as LibreOfficeEditor.onBackendHealth: the automatic restart passes
 * degraded → restarting → starting → healthy, so remember "was down since the last healthy" rather than
 * comparing with the previous snapshot only. No host backend (web edition, old shell): a no-op.
 * @returns {() => void} unsubscribe
 */
export function watchLocalServiceRecovery(backend, onRecovered) {
  if (!backend || typeof backend.onHealthChanged !== 'function') return () => {}
  let wasDown = false
  const unsubscribe = backend.onHealthChanged((snapshot) => {
    if (!snapshot || typeof snapshot.state !== 'string') return
    if (['degraded', 'restarting', 'failed'].includes(snapshot.state)) { wasDown = true; return }
    if (snapshot.state === 'healthy' && snapshot.ok === true && wasDown) {
      wasDown = false
      try { onRecovered() } catch (e) { /* a recovery hook must never break the health stream */ }
    }
  })
  return typeof unsubscribe === 'function' ? unsubscribe : () => {}
}
