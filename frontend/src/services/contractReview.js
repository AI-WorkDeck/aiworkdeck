// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import api from '@/services/api.js'

const base = (pid) => `/api/projects/${encodeURIComponent(pid)}/contract-review`
function unwrap(value) {
  return value && typeof value === 'object' && 'code' in value && 'data' in value ? value.data : value
}
function request(pid, path, method = 'GET', data) {
  return api.request({ url: base(pid) + path, method, data,
    header: { 'Content-Type': 'application/json' }, timeout: 120000, logBody: false }).then(unwrap)
}
export const listReviewStandards = (pid) => request(pid, '/standards')
export const saveReviewStandard = (pid, data) => request(pid, '/standards', 'POST', data)
export const confirmReviewStandard = (pid, id, version) => request(pid, `/standards/${encodeURIComponent(id)}/confirm`, 'POST', { version })
export const getContractReview = (pid, docFileId) => request(pid, '/runs', 'GET', { docFileId })
export const runContractReview = (pid, data) => request(pid, '/runs', 'POST', data)
