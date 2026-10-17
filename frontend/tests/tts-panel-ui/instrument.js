// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
window.__qaAudit = { requests: [], audios: [], audioEvents: [], highlights: [], keys: [], focuses: [], inputs: [], imports: [] }
document.addEventListener('keydown', event => window.__qaAudit.keys.push({ key: event.key, trusted: event.isTrusted, target: event.target.className }), true)
document.addEventListener('input', event => window.__qaAudit.inputs.push({ time: performance.now(), value: event.target.value, trusted: event.isTrusted }), true)
document.addEventListener('focusin', event => window.__qaAudit.focuses.push({ time: performance.now(), target: event.target.className }), true)
window.__qaConfig = { delay: 100, delays: [40, 300], duration: 0.7, failAt: -1 }
const NativeAudio = window.Audio
window.Audio = function (...args) {
  const audio = new NativeAudio(...args)
  const id = window.__qaAudit.audios.push(audio) - 1
  for (const name of ['playing', 'pause', 'ended', 'error', 'ratechange']) {
    audio.addEventListener(name, () => window.__qaAudit.audioEvents.push({ name, id, time: performance.now(), currentTime: audio.currentTime, rate: audio.playbackRate }))
  }
  return audio
}
window.Audio.prototype = NativeAudio.prototype
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light'
