// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { request } from '../adapters/bridge.js'
export const insight = (operation, params = {}) => request('insight', operation, params, { timeoutMs: 120000 })
export const parseDocInsight = (_pid, docFileId) => insight('parse', { docFileId })
export const getDocInsight = (_pid, docFileId) => insight('get', { docFileId })
export const getDocInsightEntity = (_pid, entityId) => insight('entity', { entityId })
export const refreshDocInsightEntity = (_pid, entityId) => insight('refreshEntity', { entityId })
export const listReviewStandards = () => insight('standards')
export const saveReviewStandard = (_pid, payload) => insight('saveStandard', payload)
export const confirmReviewStandard = (_pid, id, version) => insight('confirmStandard', { id, version })
export const getContractReview = (_pid, docFileId) => insight('review', { docFileId })
export const runContractReview = (_pid, payload) => insight('runReview', payload)
