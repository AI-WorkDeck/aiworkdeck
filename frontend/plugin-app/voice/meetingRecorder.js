// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { reactive } from 'vue'
import { voice } from './api.js'
export const recorderState = reactive({ status: 'idle', projectId: null, seconds: 0, level: 0 })
export async function refreshRecorder() { Object.assign(recorderState, await voice('recordingState')) }
export const isRecordingActive = () => !['idle', 'error'].includes(recorderState.status)
export const listAudioInputDevices = () => voice('devices')
export async function startRecording(_projectId, deviceId) { const result = await voice('start', { deviceId }, { timeoutMs: 120000 }); await refreshRecorder(); return result }
export async function stopRecording() {
  const meetingId = recorderState.meetingId
  try {
    const result = await voice('stop', {}, { timeoutMs: 120000 })
    await refreshRecorder()
    return result
  } catch (error) {
    if (error.code !== 'timeout' || meetingId == null) throw error
    // Uploads and the user's paid-transcription decision can outlive one RPC.
    // The host keeps the real result (including null on finish failure).
    while (true) {
      await refreshRecorder()
      if (String(recorderState.lastStop?.meetingId) === String(meetingId)) return recorderState.lastStop.meeting
      if (recorderState.status !== 'stopping' || String(recorderState.meetingId) !== String(meetingId)) throw error
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}
export async function pauseRecording() { await voice('pause'); await refreshRecorder() }
export async function resumeRecording() { await voice('resume'); await refreshRecorder() }
export function formatSeconds(total) { const seconds = Math.max(0, Math.floor(Number(total) || 0)); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') }
