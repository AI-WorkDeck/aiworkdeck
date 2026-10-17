// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Only the HTTP/host boundary is adapted. The production reader and Audio are real.
export async function getTtsVoices() {
  const response = await fetch('/kokoro/v1/audio/voices')
  if (!response.ok) throw new Error(`Voices HTTP ${response.status}`)
  return (await response.json()).voices
}
export async function generateTtsAudio(data, { signal } = {}) {
  const audit = window.__audit
  const config = window.__testConfig
  const index = audit.requests.length
  const entry = { index, text: data.text, rate: data.rate, start: performance.now(), mode: config.mode }
  audit.requests.push(entry)
  const endpoint = config.mode === 'real' ? '/kokoro/v1/audio/speech' : '/test-audio'
  try {
    const response = await fetch(endpoint, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: data.text, voice: data.voice, speed: Number(data.rate), response_format: 'wav',
        ...(config.mode === 'real' ? {} : { delay: config.delays[index] ?? 100, duration: config.duration, fail: config.failAt === index }) }) })
    if (!response.ok) throw new Error(`Speech HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    entry.end = performance.now()
    entry.bytes = buffer.byteLength
    return buffer
  } catch (error) { entry.error = error.name; entry.end = performance.now(); throw error }
}
export function promptFeatureNotConfigured(error) { window.__audit.toasts.push({ error: String(error) }) }
