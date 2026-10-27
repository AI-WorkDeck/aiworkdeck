// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { request } from '../adapters/bridge.js'
export const voice = (operation, params = {}, options) => request('voice', operation, params, options)
export const getTtsVoices = () => voice('voices')
export const generateTtsAudio = (params, options) => voice('synthesize', params, options)
export const promptFeatureNotConfigured = () => {
  let isEn = false
  try {
    if (typeof document !== 'undefined' && document.documentElement?.lang === 'en-US') isEn = true
    else if (typeof localStorage !== 'undefined' && localStorage.getItem('checkba_app_language') === 'en-US') isEn = true
  } catch (_) { /* ignore */ }
  return window.awd.ui.toast(isEn ? 'Speech component is not ready yet. Please check again.' : '语音组件尚未就绪，请重新检测。')
}
export const getMeetingRecordings = () => voice('list')
export const getMeetingRecording = id => voice('get', { id })
export const transcribeMeetingRecording = id => voice('transcribe', { id }, { timeoutMs: 120000 })
export const updateMeetingRecording = (id, payload) => voice('update', { id, payload })
export const exportMeetingTranscript = id => voice('export', { id })
export const getMeetingMinutesPrompt = id => voice('minutes', { id })
export const deleteMeetingRecording = id => voice('delete', { id })
export const getPlatformServices = () => voice('tier')
export const setPlatformServiceProvider = (_service, provider) => voice('setTier', { provider })
export const getMeetingAsrNotice = () => voice('notice')
export const acknowledgeMeetingAsrNotice = () => voice('acknowledgeNotice')
export const probeLocalAsr = () => voice('probe')
export const getApiBaseUrl = () => { throw new Error('Direct network access is unavailable in plugins') }
