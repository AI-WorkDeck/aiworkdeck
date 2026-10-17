// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createApp, h, ref, nextTick } from 'vue'
import EasyVoicePane from '../../src/components/EasyVoicePane.vue'
import panels from '../../src/locales/zh-CN/panels.js'
import 'virtual:app-tokens.css'

window.__audit = { requests: [], audioEvents: [], audios: [], toasts: [], highlights: [] }
window.__testConfig = { mode: 'synthetic', delays: [50, 800, 800, 800], duration: 2, failAt: -1 }
window.uni = { showToast: x => window.__audit.toasts.push(x), $emit() {} }
const NativeAudio = window.Audio
window.Audio = function (...args) {
  const audio = new NativeAudio(...args)
  const id = window.__audit.audios.push(audio) - 1
  for (const name of ['playing', 'pause', 'ended', 'error', 'ratechange']) {
    audio.addEventListener(name, () => window.__audit.audioEvents.push({ name, id, time: performance.now(), currentTime: audio.currentTime, playbackRate: audio.playbackRate }))
  }
  return audio
}
window.Audio.prototype = NativeAudio.prototype
const visible = ref(true)
const pane = ref(null)
const app = createApp({ render: () => visible.value ? h(EasyVoicePane, {
  ref: pane,
  onHighlightSentence: text => window.__audit.highlights.push(text)
}) : null })
app.config.globalProperties.$t = (key, vars = {}) => {
  const value = panels[key.replace(/^panels\./, '')] || key
  return value.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? `{${name}}`)
}
app.component('slider', {
  props: ['value', 'min', 'max', 'step'], emits: ['change', 'changing'],
  render() {
    const event = name => e => this.$emit(name, { detail: { value: Number(e.target.value) } })
    return h('input', { type: 'range', 'aria-label': '播放速度', value: this.value, min: this.min, max: this.max, step: this.step, onChange: event('change'), onInput: event('changing'), style: 'width:100%;accent-color:var(--awd-accent)' })
  }
})
app.mount('#app')
window.__harness = {
  pane: () => pane.value,
  async unmount() { visible.value = false; await nextTick() },
  snapshot() {
    const s = pane.value?.reading
    const active = window.__audit.audios.find(a => !a.paused && a.src)
    return { status: s?.status, generated: s?.generated, generating: s?.generating, segments: s ? Array.from(s.segments) : [], currentIndex: s?.currentIndex,
      exportBytes: s?.exportBuffer?.byteLength || 0, activeText: document.querySelector('.reading-segment.active')?.textContent,
      audio: active && { currentTime: active.currentTime, playbackRate: active.playbackRate } }
  },
  async decodeExport() {
    const context = new AudioContext()
    try {
      const decoded = await context.decodeAudioData(pane.value.reading.exportBuffer.slice(0))
      return { duration: decoded.duration, frames: decoded.length, channels: decoded.numberOfChannels, sampleRate: decoded.sampleRate }
    } finally { await context.close() }
  }
}
const style = document.createElement('style')
style.textContent = 'html,body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:var(--awd-text);background:var(--awd-surface)}*{box-sizing:border-box}#app{width:380px;height:840px}.easy-voice-pane,.reading-transcript,.voice-list-scroll{overflow-y:auto}button,input,textarea{font:inherit}button{cursor:pointer}'
document.head.append(style)
