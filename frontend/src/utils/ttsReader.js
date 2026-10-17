// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { splitTtsText } from './ttsText.js'
import { readPcmWav, mergePcmWavs } from './ttsWav.js'

const emptyState = () => ({ status: 'idle', segments: [], currentIndex: -1, generated: 0, generating: false, paused: false, exportBuffer: null })

/** One reader owns one request and one playing segment; stopping invalidates both. */
export function createTtsReader({ generate, onChange, onError, createAudio = url => new Audio(url), urls = URL }) {
  let state = emptyState()
  let session = null
  let rate = 1
  let destroyed = false
  const publish = patch => {
    state = { ...state, ...patch }
    if (!destroyed) onChange(state)
  }
  const live = current => !destroyed && current === session && !current.abort.signal.aborted
  const releaseAudio = current => {
    current.playAttempt++
    if (!current.audio) return
    const audio = current.audio
    current.audio = null
    audio.onplaying = audio.onended = audio.onwaiting = audio.onpause = audio.onerror = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    urls.revokeObjectURL(current.url)
    current.url = ''
  }
  const stop = () => {
    if (session) {
      session.abort.abort()
      releaseAudio(session)
      session = null
    }
    publish(emptyState())
  }
  const playbackError = (current, error) => {
    if (!live(current)) return
    current.wantsPlay = false
    current.audio?.pause()
    publish({ status: 'paused', paused: true })
    onError(error, 'playback')
  }
  const play = current => {
    if (!live(current) || !current.wantsPlay) return
    if (!current.audio) {
      if (current.next >= state.segments.length) {
        current.wantsPlay = false
        publish({ status: 'complete', currentIndex: -1, paused: false })
        return
      }
      const buffer = current.buffers[current.next]
      if (!buffer) { publish({ status: 'buffering', currentIndex: -1 }); return }
      current.url = urls.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
      const audio = createAudio(current.url)
      const index = current.next
      current.audio = audio
      audio.playbackRate = rate
      audio.preservesPitch = true
      audio.onplaying = () => {
        if (!live(current) || current.audio !== audio) return
        if (!current.wantsPlay) { audio.pause(); return }
        publish({ status: 'playing', currentIndex: index, paused: false })
      }
      audio.onwaiting = () => {
        if (live(current) && current.audio === audio && current.wantsPlay) publish({ status: 'buffering' })
      }
      audio.onended = () => {
        if (!live(current) || current.audio !== audio) return
        releaseAudio(current)
        current.next++
        publish({ currentIndex: -1 })
        if (current.wantsPlay) play(current)
      }
      audio.onpause = () => {
        if (!live(current) || current.audio !== audio || !audio.paused || audio.ended || !current.wantsPlay) return
        current.wantsPlay = false
        current.playAttempt++
        publish({ status: 'paused', paused: true })
      }
      audio.onerror = () => {
        if (current.audio === audio) playbackError(current, new Error('Audio playback failed'))
      }
    }
    const audio = current.audio
    const attempt = ++current.playAttempt
    Promise.resolve(audio.play()).catch(error => {
      if (live(current) && current.audio === audio && current.wantsPlay && current.playAttempt === attempt) playbackError(current, error)
    })
  }
  return {
    getState: () => state,
    async start({ text, voice, playbackRate = rate }) {
      stop()
      if (destroyed || !voice) return
      const segments = splitTtsText(text)
      if (!segments.length) return
      rate = playbackRate
      const current = { abort: new AbortController(), buffers: [], next: 0, audio: null, url: '', wantsPlay: true, playAttempt: 0 }
      session = current
      publish({ status: 'buffering', segments, generating: true })
      try {
        for (const segment of segments) {
          const buffer = await generate({ text: segment.trim(), voice, rate: '1' }, { signal: current.abort.signal })
          if (!live(current)) return
          readPcmWav(buffer)
          current.buffers.push(buffer)
          publish({ generated: current.buffers.length })
          if (!current.audio && current.wantsPlay) play(current)
        }
        if (!live(current)) return
        publish({ generating: false, exportBuffer: mergePcmWavs(current.buffers) })
      } catch (error) {
        if (!live(current)) return
        current.abort.abort()
        releaseAudio(current)
        current.wantsPlay = false
        publish({ status: 'error', currentIndex: -1, generating: false, paused: false, exportBuffer: null })
        onError(error, 'generation')
      }
    },
    pause() {
      if (!session || !live(session)) return
      session.wantsPlay = false
      session.playAttempt++
      session.audio?.pause()
      publish({ status: 'paused', paused: true })
    },
    resume() {
      if (!session || !live(session)) return
      if (session.next >= state.segments.length) session.next = 0
      session.wantsPlay = true
      publish({ status: 'buffering', paused: false })
      play(session)
    },
    setRate(value) {
      rate = value
      if (session?.audio) session.audio.playbackRate = value
    },
    stop,
    destroy() { stop(); destroyed = true }
  }
}
