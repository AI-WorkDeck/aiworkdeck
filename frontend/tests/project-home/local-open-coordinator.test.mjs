// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalOpenCoordinator } from '../../src/utils/localOpenCoordinator.js'

function setup(overrides = {}) {
  const opened = [], paths = [], navigations = []
  let coordinator
  const vm = { projectId: 9, openFile: f => opened.push(f.id) }
  coordinator = createLocalOpenCoordinator({
    openFile: async ({ path }) => { paths.push(path); return { data: { projectId: 9, file: { id: path, name: '合同.docx' } } } },
    navigate: async url => { navigations.push(url); queueMicrotask(() => coordinator.register(vm)) },
    ready: () => {}, failedMessage: () => 'open failed', timeoutMs: 50,
    ...overrides,
  })
  return { coordinator, vm, opened, paths, navigations }
}

test('cold opening waits for mounted/restored workbench; cross-folder files append without another navigation', async () => {
  const { coordinator, paths, opened, navigations } = setup()
  await Promise.all([coordinator.open('/甲/合同.docx'), coordinator.open('/乙/合同.docx')])
  assert.deepEqual(paths, ['/甲/合同.docx', '/乙/合同.docx'])
  assert.deepEqual(opened, paths)
  assert.equal(navigations.length, 1)
  assert.match(navigations[0], /id=9&loose=1$/)
})

test('leaving a real project waits for its save guard; save failure retains the original page', async () => {
  const { coordinator, navigations, opened } = setup()
  let saved = 0
  coordinator.register({ projectId: 3, leaveWorkbench: async () => { saved++; return false } })
  assert.equal(await coordinator.open('/合同.docx'), false)
  assert.equal(saved, 1)
  assert.deepEqual(navigations, [])
  assert.deepEqual(opened, [])
})

test('an already running workspace focuses through openFile without destroying its editors', async () => {
  const { coordinator, vm, navigations, opened } = setup()
  coordinator.register(vm)
  await coordinator.open('/合同.docx')
  assert.deepEqual(navigations, [])
  assert.deepEqual(opened, ['/合同.docx'])
})

test('failed path does not poison subsequent requests', async () => {
  const { coordinator, opened } = setup({ openFile: async ({ path }) => {
    if (path === 'missing') throw new Error('file missing')
    return { data: { projectId: 9, file: { id: path } } }
  } })
  const first = coordinator.open('missing')
  const second = coordinator.open('valid.pdf')
  await assert.rejects(first, /file missing/)
  await second
  assert.deepEqual(opened, ['valid.pdf'])
})

test('navigation failure and missing readiness surface errors rather than losing requests silently', async () => {
  const failed = setup({ navigate: async () => { throw new Error('navigation failed') } })
  await assert.rejects(failed.coordinator.open('one.pdf'), /navigation failed/)
  const stalled = setup({ navigate: async () => {}, timeoutMs: 5 })
  await assert.rejects(stalled.coordinator.open('two.pdf'), /open failed/)
})

test('old workbench unmount cannot unregister a newly active instance', async () => {
  const { coordinator, vm, navigations } = setup()
  const old = { projectId: 1 }
  coordinator.register(old)
  coordinator.register(vm)
  coordinator.unregister(old)
  await coordinator.open('test.txt')
  assert.equal(navigations.length, 0)
})


test('slow successful saves do not consume the destination readiness timeout', async () => {
  const { coordinator, vm, opened } = setup({ timeoutMs: 5 })
  coordinator.register({ projectId: 3, leaveWorkbench: async () => {
    await new Promise(resolve => setTimeout(resolve, 20))
    coordinator.register(vm)
    return true
  } })
  assert.equal(await coordinator.open('slow.docx'), true)
  assert.deepEqual(opened, ['slow.docx'])
})
