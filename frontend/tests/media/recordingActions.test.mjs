// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSfc } from './sfcLoader.mjs'
const Actions = await loadSfc('components/media/RecordingActions.vue')
function context() {
  const events = []
  return { ...Actions.data(), meeting: { id: 14, status: 'TRANSCRIBED' }, events,
    $emit: (...args) => events.push(args), $t: (k, p) => k + JSON.stringify(p || {}) }
}
test('minutes and todos dispatch the prompt for the selected recording', async () => {
  for (const action of ['minutes', 'todos']) {
    const ctx = context()
    globalThis.__recordingApi = { [action]: async id => { assert.equal(id, 14); return { prompt: action } } }
    await Actions.methods.run.call(ctx, action)
    assert.equal(ctx.events[0][0], 'ai-prompt')
    assert.equal(ctx.events[0][1].prompt, action)
    assert.equal(ctx.busy, '')
  }
})
test('interview record reuses the minutes prompt chain with format=interview (issue 31)', async () => {
  const ctx = context()
  const calls = []
  globalThis.__recordingApi = { minutes: async (id, format) => { calls.push([id, format]); return { prompt: format || 'minutes' } } }
  await Actions.methods.run.call(ctx, 'interview')
  await Actions.methods.run.call(ctx, 'minutes')
  assert.deepEqual(calls, [[14, 'interview'], [14, undefined]])
  assert.deepEqual(ctx.events.map((e) => e[1].prompt), ['interview', 'minutes'])
})
test('Word export refreshes files only after successful save', async () => {
  const ctx = context()
  globalThis.__recordingApi = { export: async id => { assert.equal(id, 14); return { file: { id: 9, name: 'Transcript.docx' }, folderName: 'Recordings' } } }
  await Actions.methods.run.call(ctx, 'export')
  assert.deepEqual(ctx.events, [['files-changed', { id: 9, name: 'Transcript.docx' }]])
  assert.match(ctx.message, /Transcript.docx/)
  globalThis.__recordingApi.export = async () => { throw new Error('denied') }
  ctx.events.length = 0
  await Actions.methods.run.call(ctx, 'export')
  assert.equal(ctx.events.length, 0)
  assert.match(ctx.message, /denied/)
  assert.equal(ctx.busy, '')
})
test('pending request blocks double clicks and stale meeting does not dispatch', async () => {
  const ctx = context()
  let resolve, calls = 0
  globalThis.__recordingApi = { todos: () => { calls++; return new Promise(r => { resolve = r }) } }
  const pending = Actions.methods.run.call(ctx, 'todos')
  await Actions.methods.run.call(ctx, 'todos')
  assert.equal(calls, 1)
  ctx.meeting = { id: 99, status: 'TRANSCRIBED' }
  resolve({ prompt: 'old' })
  await pending
  assert.deepEqual(ctx.events, [])
})
test('untranscribed recordings cannot start actions', async () => {
  const ctx = context()
  ctx.meeting.status = 'TRANSCRIBING'
  globalThis.__recordingApi = { todos: () => assert.fail('must not request') }
  await Actions.methods.run.call(ctx, 'todos')
  assert.deepEqual(ctx.events, [])
})
test('unmount invalidates pending prompt and export completions', async () => {
  for (const action of ['minutes', 'export']) {
    const ctx = context()
    let resolve
    globalThis.__recordingApi = { [action]: () => new Promise(r => { resolve = r }) }
    const pending = Actions.methods.run.call(ctx, action)
    assert.ok(ctx.message)
    Actions.beforeUnmount.call(ctx)
    resolve({ prompt: 'old', file: { name: 'old.docx' } })
    await pending
    assert.deepEqual(ctx.events, [])
  }
})
test('recording actions render only in an opted-in audio host with a ready transcript', async () => {
  const { createSSRApp } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const Player = await loadSfc('components/media/MediaPlayer.vue')
  for (const [enabled, kind, state, visible] of [[false, 'audio', 'ready', false], [true, 'video', 'ready', false], [true, 'audio', 'transcribing', false], [true, 'audio', 'ready', true]]) {
    const app = createSSRApp({ extends: Player, ssrRender: Player.ssrRender,
      data: () => ({ captionState: state, meeting: { id: 14, status: 'TRANSCRIBED' } }) },
      { kind, recordingActionsEnabled: enabled })
    app.config.globalProperties.$t = k => k
    app.config.warnHandler = () => {}
    const html = await renderToString(app)
    assert.equal(html.includes('meeting.fileTodos'), visible, `${enabled}/${kind}/${state}`)
  }
})
