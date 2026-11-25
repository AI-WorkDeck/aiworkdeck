// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X-S1 part 3: the only way to put a failure into a toast. See errorTextFor in userMessage.js.
import { t } from '@/i18n'
import { errorTextFor } from './userMessage.js'

/** Text for a failure toast: catalogue / backend business message / the caller's fallback. Never raw. */
export function errorText(err, fallbackText = '', ctx = {}) {
  if (err) console.warn('[error]', err)
  // In the desktop app a refused request means the local service, not the user's internet (same rule as AwdInlineError)
  const desktop = typeof window !== 'undefined' && !!window.checkbaDesktop
  return errorTextFor(err, fallbackText, (k, p) => t(k, p), { desktop, ...ctx })
}
