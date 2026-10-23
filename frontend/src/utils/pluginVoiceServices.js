// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import * as api from '@/services/api.js'
import { host } from '@/services/host.js'
import * as recorder from '@/utils/meetingRecorder.js'
import { componentDownloads } from '@/services/componentDownloads.js'
import { showDialog } from '@/utils/dialog.js'
import { requireAccount } from '@/utils/requireAccount.js'
import { confirmPaidTranscription } from '@/utils/paidTranscribeGate.js'
import { readPcmWav } from '@/utils/ttsWav.js'
import { getAuthHeaders } from '@/utils/auth.js'

const PACKS = ['kokoro-runtime', 'asr-runtime']
const MODELS = ['kokoro-models', 'asr-models']
const error = (code, message) => { throw Object.assign(new Error(message), { code }) }
const clone = value => JSON.parse(JSON.stringify(value))

// MediaRecorder and component downloads remain application services. Destroying
// a plugin cancels its requests, not the user's background recording/download.
export function createPluginVoiceServices({ projectId, permissions, isCurrent, actions }) {
  let sourceFileId = null
  const installResults = new Map()
  let lastStop = null
  const allowed = permission => { if (!permissions().includes(permission)) error('permission_denied', permission + ' is required') }
  const check = signal => { if (signal.aborted || !isCurrent()) error('cancelled', 'Request cancelled') }
  const confirm = async (content, signal) => {
    const result = await showDialog({ title: '语音', content })
    check(signal)
    if (!result.confirm) error('cancelled', 'Cancelled')
  }
  const meeting = async (id, signal) => {
    if (!projectId()) error('no_project', 'A project is required')
    const data = await api.getMeetingRecordings(projectId())
    check(signal)
    const row = (data.meetings || []).find(row => String(row.id) === String(id))
    if (!row) error('not_found', 'Recording not found in this project')
    return row
  }
  const cloudGate = async signal => {
    const data = await api.getMeetingRecordings(projectId())
    check(signal)
    if (data.tier !== 'local') {
      allowed('network')
      const notice = await api.getMeetingAsrNotice()
      check(signal)
      if (data.tier === 'platform' && notice && !notice.acknowledged) error('notice_required', 'Confirm the transcription notice first')
    }
  }
  return {
    async request(operation, params, signal) {
      allowed('speech'); check(signal)
      if (operation === 'voices') return api.getTtsVoices()
      if (operation === 'synthesize') {
        if (typeof params.text !== 'string' || params.text.length > 2000 || typeof params.voice !== 'string' || params.voice.length > 200) error('invalid_params', 'Invalid speech input')
        return api.generateTtsAudio({ text: params.text, voice: params.voice, rate: 1 }, { signal })
      }
      if (operation === 'download') {
        allowed('file_write')
        if (!(params.content instanceof ArrayBuffer) || params.content.byteLength > 256 * 1024 * 1024) error('invalid_params', 'Invalid audio artifact')
        readPcmWav(params.content)
        await actions.download({ content: params.content, type: 'audio/wav', name: 'voice_' + Date.now() + '.wav' })
        return { downloaded: true }
      }
      if (operation === 'importText') {
        allowed('file_read')
        const source = await actions.importVoiceText(signal); check(signal)
        sourceFileId = source?.fileId || null
        return source?.text || ''
      }
      if (operation === 'highlight' || operation === 'clearHighlight') {
        allowed('editor')
        return operation === 'highlight' ? actions.highlightVoice({ sentence: String(params.sentence || '').slice(0, 4000), fileId: sourceFileId }) : actions.clearVoiceHighlight({ fileId: sourceFileId })
      }
      if (operation === 'capabilities') return { desktop: !!host.model }
      if (operation === 'modelStatus') return host.model ? host.model.status() : { components: [] }
      if (operation === 'modelCancel') {
        if (!MODELS.includes(params.id)) error('invalid_params', 'Unknown speech model')
        return host.model?.cancel(params.id)
      }
      if (operation === 'ensure') return host.services?.ensure('kokoro-service')
      if (operation === 'components' || operation === 'componentInstall') {
        await componentDownloads.load(); check(signal)
        const items = componentDownloads.state.items.filter(item => PACKS.includes(item.packId))
        if (operation === 'componentInstall') {
          const item = items.find(item => item.packId === params.packId)
          if (!item) error('invalid_params', 'Unknown speech component')
          // The manager owns the long-running job; callers poll its real state.
          const result = { ok: null, error: '' }
          installResults.set(item.packId, result)
          componentDownloads.installOne(item).then(ok => { result.ok = ok; result.error = item.error || '' })
        }
        return clone(items.map(item => {
          const installing = componentDownloads.isInstalling(item.packId)
          const result = installResults.get(item.packId)
          return { ...item, installing, installResult: result?.ok ?? null, installError: result?.error || '' }
        }))
      }
      if (operation === 'probe') return api.probeLocalAsr()
      if (operation === 'requireAccount') return requireAccount({ reason: 'meeting' })
      if (operation === 'tier') {
        const data = await api.getPlatformServices()
        const asr = (data.services || []).find(item => item.service === 'asr')
        return { platformAvailable: data.platformAvailable, accountConnected: data.accountConnected, services: asr ? [{ service: 'asr', provider: asr.provider, hasLocal: asr.hasLocal, hasByokCredentials: asr.hasByokCredentials }] : [] }
      }
      if (operation === 'setTier') {
        if (!['local', 'platform'].includes(params.provider)) error('invalid_params', 'Unsupported speech provider')
        if (params.provider === 'platform') { allowed('network'); await confirm('使用宿主的云端转写服务？音频会上传至已配置的服务。', signal) }
        return api.setPlatformServiceProvider('asr', params.provider)
      }
      if (operation === 'notice') return api.getMeetingAsrNotice()
      if (operation === 'acknowledgeNotice') {
        allowed('network')
        const notice = await api.getMeetingAsrNotice(); check(signal)
        await confirm(String(notice?.body || notice?.content || '确认已阅读录音转写告知，并允许使用云端转写服务？'), signal)
        return api.acknowledgeMeetingAsrNotice(true)
      }
      allowed('file_read')
      if (!projectId()) error('no_project', 'A project is required')
      if (operation === 'recordingState') {
        const state = recorder.recorderState
        const visible = String(state.projectId) === String(projectId()) || !recorder.isRecordingActive()
          ? clone(state) : { status: state.status, projectId: null, seconds: 0, level: 0 }
        return { ...visible, lastStop: lastStop && String(lastStop.projectId) === String(projectId()) ? clone(lastStop) : null }
      }
      if (operation === 'devices') {
        const devices = await recorder.listAudioInputDevices()
        // MediaDeviceInfo fields are prototype getters; the plugin bridge copies
        // own enumerable properties only. Send plain records so names and IDs survive.
        return devices.map(({ deviceId, label, kind, groupId }) => ({ deviceId, label, kind, groupId }))
      }
      if (operation === 'list') return api.getMeetingRecordings(projectId())
      if (operation === 'start') {
        allowed('file_write'); await cloudGate(signal)
        await confirm('开始录音并保存到当前项目？录音会在切换面板后继续，直到你停止。', signal)
        const devices = await recorder.listAudioInputDevices(); check(signal)
        const deviceId = devices.some(d => d.deviceId === params.deviceId) ? params.deviceId : undefined
        await recorder.startRecording(projectId(), deviceId, { signal, isCurrent })
        return clone(recorder.recorderState)
      }
      if (['pause', 'resume', 'stop'].includes(operation)) {
        allowed('file_write')
        if (String(recorder.recorderState.projectId) !== String(projectId())) error('permission_denied', 'Recording belongs to another project')
        if (operation === 'stop') {
          const stopped = { meetingId: recorder.recorderState.meetingId, projectId: recorder.recorderState.projectId }
          const meeting = await recorder.stopRecording()
          if (recorder.recorderState.status !== 'stopping') lastStop = { ...stopped, meeting }
          return meeting
        }
        return recorder[operation === 'pause' ? 'pauseRecording' : 'resumeRecording']()
      }
      if (!['get', 'audio', 'minutes', 'transcribe', 'update', 'export', 'delete'].includes(operation)) error('unknown_operation', 'Unknown voice operation')
      const row = await meeting(params.id, signal)
      if (operation === 'get') return api.getMeetingRecording(row.id)
      if (operation === 'audio') {
        const response = await fetch(api.getApiBaseUrl() + '/api/files/' + encodeURIComponent(row.audioFileId) + '/download', { headers: getAuthHeaders(), signal, redirect: 'error' })
        if (!response.ok) error('download_failed', 'Audio download failed')
        return { bytes: await response.arrayBuffer(), type: response.headers.get('content-type') || 'audio/wav' }
      }
      if (operation === 'minutes') return api.getMeetingMinutesPrompt(row.id)
      allowed('file_write')
      if (operation === 'transcribe') {
        await cloudGate(signal)
        if (!(await confirmPaidTranscription({ projectId: projectId(), durationMs: row.durationMs, audioFileId: row.audioFileId }))) error('cancelled', 'Cancelled')
        check(signal)
        return api.transcribeMeetingRecording(row.id)
      }
      if (operation === 'update') {
        const payload = {}
        if (typeof params.payload?.title === 'string') payload.title = params.payload.title.slice(0, 500)
        if (params.payload?.speakerNames && typeof params.payload.speakerNames === 'object') payload.speakerNames = params.payload.speakerNames
        return api.updateMeetingRecording(row.id, payload)
      }
      if (operation === 'export') return api.exportMeetingTranscript(row.id)
      if (operation === 'delete') { await confirm('删除这份会议录音？', signal); return api.deleteMeetingRecording(row.id) }
      error('unknown_operation', 'Unknown voice operation')
    },
  }
}
