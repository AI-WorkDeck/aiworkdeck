// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// For SFC harnesses that strip imports: the real X-S1 toast-text logic (utils/errorToast.js)
// with an identity translator, so a test injects the same behaviour the component imports.
import { errorTextFor } from '../../src/utils/userMessage.js'

export const errorText = (err, fallbackText = '', ctx = {}) => errorTextFor(err, fallbackText, (k) => k, ctx)
