// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { reactive } from 'vue'
import { voice } from './api.js'
export const recorderState = reactive({ status: 'idle', projectId: null, seconds: 0, level: 0 })
export async function refreshRecorder() { Object.assign(recorderState, await voice('recordingState')) }
export const isRecordingActive = () => !['idle', 'error'].includes(recorderState.status)
export const listAudioInputDevices = () => voice('devices')
export async function startRecording(_projectId, deviceId) { const result = await voice('start', { deviceId }, { timeoutMs: 120000 }); await refreshRecorder(); return result }
export async function stopRecording() { const result = await voice('stop', {}, { timeoutMs: 120000 }); await refreshRecorder(); return result }
export async function pauseRecording() { await voice('pause'); await refreshRecorder() }
export async function resumeRecording() { await voice('resume'); await refreshRecorder() }
export function formatSeconds(total) { const seconds = Math.max(0, Math.floor(Number(total) || 0)); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') }
