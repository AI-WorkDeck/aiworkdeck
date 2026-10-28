// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CN_FONT_SIZES, PT_FONT_SIZES } from '../../src/utils/paragraphFormat.js'
import * as viewPrefs from '../../src/utils/editorViewPrefs.js'
const source = readFileSync(new URL('../../src/components/EditorToolbar.vue', import.meta.url), 'utf8')
function vmFor(handler) {
  const component = new Function('bindHorizontalWheel', 'watchScrollEdges', 'isEnglish', 'host', 'CN_FONT_SIZES', 'PT_FONT_SIZES', 'ParagraphFormatPanel', 'SystemFontsPanel', ...Object.keys(viewPrefs), source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return'))(() => () => {}, () => () => {}, () => false, {}, CN_FONT_SIZES, PT_FONT_SIZES, {}, {}, ...Object.values(viewPrefs))
  const events = [], calls = []
  const vm = { ...component.data(), isImpress: true, impressState: { slideNumber: 3, slideCount: 9 }, $t: k => k, $emit: e => events.push(e), executor: { executeCommand: async (action, params) => { calls.push({ action, params }); return handler(params) } } }
  for (const [name, method] of Object.entries(component.methods)) vm[name] = method.bind(vm)
  vm.refresh = async () => { vm.refreshed = true }
  vm.closeMenus = () => {}
  return { vm, calls, events }
}
test('starts current slide without document modification and synchronizes native exit', async () => {
  const { vm, calls, events } = vmFor(({ operation }) => ({ success: true, running: operation === 'start', slideNumber: 3, slideCount: 9 }))
  await vm.controlSlideshow('start')
  assert.deepEqual(calls[0], { action: 'slide_show_control', params: { operation: 'start', slideNumber: 3 } })
  assert.equal(vm.slideshowRunning, true)
  assert.ok(vm._slideshowTimer)
  assert.deepEqual(events, ['focus-editor'])
  await vm.controlSlideshow('state')
  assert.equal(vm.slideshowRunning, false)
  assert.equal(vm._slideshowOwner, null)
  assert.equal(vm.refreshed, true)
  vm.disposeSlideshow()
})
test('disposal ends only original executor and ignores its late start result', async () => {
  let resolve
  const { vm, calls } = vmFor(({ operation }) => operation === 'start' ? new Promise(r => { resolve = r }) : { success: true, running: false })
  const start = vm.controlSlideshow('start')
  await vm.controlSlideshow('start')
  assert.equal(calls.length, 1)
  vm.disposeSlideshow()
  vm.executor = { executeCommand: () => { throw Error('must not touch new document') } }
  resolve({ success: true, running: true })
  await start
  assert.equal(vm.slideshowRunning, false)
  assert.equal(calls[1].params.operation, 'end')
})
test('failed exit retains playback controls and polling', async () => {
  const { vm } = vmFor(({ operation }) => operation === 'start' ? { success: true, running: true } : { success: false })
  await vm.controlSlideshow('start')
  await vm.controlSlideshow('end')
  assert.equal(vm.slideshowRunning, true)
  assert.equal(vm.slideshowBusy, false)
  assert.equal(vm.slideshowError, 'editor.toolbar.opFailed')
  vm.disposeSlideshow()
})
test('host Escape ends show; non-PPT toolbar cannot invoke playback', async () => {
  const { vm, calls } = vmFor(({ operation }) => ({ success: true, running: operation !== 'end' }))
  vm.isImpress = false
  await vm.controlSlideshow('start')
  assert.equal(calls.length, 0)
  vm.isImpress = true
  await vm.controlSlideshow('start')
  let prevented = false
  vm.onDocKeydown({ key: 'Escape', preventDefault() { prevented = true } })
  await Promise.resolve()
  assert.equal(prevented, true)
  assert.equal(calls.at(-1).params.operation, 'end')
  vm.disposeSlideshow()
})
test('Escape during a native state read is queued until that read completes', async () => {
  let resolveState
  const { vm, calls } = vmFor(({ operation }) => operation === 'state' ? new Promise(resolve => { resolveState = resolve }) : { success: true, running: operation === 'start' })
  await vm.controlSlideshow('start')
  const poll = vm.controlSlideshow('state')
  vm.onDocKeydown({ key: 'Escape', preventDefault() {} })
  assert.equal(calls.at(-1).params.operation, 'state')
  resolveState({ success: true, running: true })
  await poll
  assert.equal(calls.at(-1).params.operation, 'end')
  assert.equal(vm.slideshowRunning, false)
  vm.disposeSlideshow()
})

test('visible navigation during background polling is applied after the read', async () => {
  let resolveState
  const { vm, calls } = vmFor(({ operation }) => operation === 'state' ? new Promise(resolve => { resolveState = resolve }) : { success: true, running: true, slideNumber: operation === 'previous' ? 2 : 3 })
  await vm.controlSlideshow('start')
  const poll = vm.controlSlideshow('state')
  assert.equal(vm.slideshowBusy, false)
  await vm.controlSlideshow('previous')
  assert.equal(calls.at(-1).params.operation, 'state')
  resolveState({ success: true, running: true, slideNumber: 3 })
  await poll
  assert.equal(calls.at(-1).params.operation, 'previous')
  assert.equal(vm.slideshowNumber, 2)
  vm.disposeSlideshow()
})
