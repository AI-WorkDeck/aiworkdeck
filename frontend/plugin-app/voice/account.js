// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { voice } from './api.js'
export const requireAccount = () => voice('requireAccount')
export const isAccountLoginRetry = error => error?.code === 4011
export const ACCOUNT_CHANGED_EVENT = 'awd:account-changed'
// The actual mutation service independently runs the trusted paid gate.
export const confirmPaidTranscription = async () => true
export const getAuthHeaders = () => { throw new Error('Host credentials are unavailable to plugins') }
