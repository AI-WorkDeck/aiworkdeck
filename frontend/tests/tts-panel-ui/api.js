// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
export async function getTtsVoices() {
  return [
    { voiceId: 'qa-zh-1', name: '晓晓', gender: 'female', locale: 'zh-CN' },
    { voiceId: 'qa-zh-2', name: '云山', gender: 'male', locale: 'zh-CN' },
    { voiceId: 'qa-en-1', name: 'Maple', gender: 'female', locale: 'en-US' },
    { voiceId: 'qa-en-2', name: 'Vale', gender: 'female', locale: 'en-GB' },
    ...Array.from({ length: 40 }, (_, index) => ({ voiceId: `qa-extra-${index}`, name: `Synthetic voice ${index + 1}`, gender: 'female', locale: 'en-US' }))
  ]
}
export async function generateTtsAudio(data, { signal } = {}) {
  const audit = window.__qaAudit
  const config = window.__qaConfig
  const index = audit.requests.length
  const entry = { index, text: data.text, voice: data.voice, rate: data.rate, started: performance.now() }
  audit.requests.push(entry)
  try {
    const response = await fetch('/__qa/audio', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delay: config.delays[index] ?? config.delay, duration: config.duration, fail: config.failAt === index }) })
    if (!response.ok) throw new Error(`Synthetic speech error ${response.status}`)
    const audio = await response.arrayBuffer()
    entry.finished = performance.now()
    entry.bytes = audio.byteLength
    return audio
  } catch (error) { entry.finished = performance.now(); entry.error = error.name; throw error }
}
export function promptFeatureNotConfigured(error) { console.error(error) }
