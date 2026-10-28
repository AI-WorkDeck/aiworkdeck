// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { wpsNativeServices, createWpsTemporaryPath } from './wpsNativeServices.js'

test('native services use add-in roots, not the VBA application object', () => {
  const application = globalThis.Application, wps = globalThis.wps
  const root = { FileSystem: { Exists: () => false }, Env: { GetTempPath: () => '/tmp/' } }
  try {
    globalThis.Application = root
    globalThis.wps = { Application: {}, WpsApplication: () => ({}) }
    assert.equal(wpsNativeServices().fileSystem, root.FileSystem)
    delete globalThis.Application
    globalThis.wps = { ...root, Application: {}, WpsApplication: () => ({}) }
    assert.equal(wpsNativeServices().environment, root.Env)
    globalThis.wps = { Application: root, WpsApplication: () => root }
    assert.equal(wpsNativeServices().fileSystem, null, 'do not take services from the document model')
  } finally {
    if (application === undefined) delete globalThis.Application; else globalThis.Application = application
    if (wps === undefined) delete globalThis.wps; else globalThis.wps = wps
  }
})

test('temporary paths require collision checks and never accept an existing path', () => {
  const services = { fileSystem: { Exists: () => false }, environment: { GetTempPath: () => 'C:\\QA\\Temp\\' } }
  assert.match(createWpsTemporaryPath(services, 'xlsx'), /^C:\\QA\\Temp\/aiworkdeck-[a-f0-9-]+\.xlsx$/)
  services.fileSystem.Exists = () => true
  assert.throws(() => createWpsTemporaryPath(services, 'xlsx'))
  services.fileSystem.Exists = () => undefined
  assert.throws(() => createWpsTemporaryPath(services, 'xlsx'))
  assert.throws(() => createWpsTemporaryPath(services, '../docx'))
})

test('HTTP WPS uses 128-bit getRandomValues when randomUUID is unavailable; absence fails closed', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  const services = { fileSystem: { Exists: () => false }, environment: { GetTempPath: () => '/tmp' } }
  let calls = 0
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues(bytes) { calls++; assert.equal(bytes.length, 16); bytes.fill(171); return bytes } } })
    assert.equal(createWpsTemporaryPath(services, 'png'), '/tmp/aiworkdeck-' + 'ab'.repeat(16) + '.png')
    assert.equal(calls, 1)
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
    assert.throws(() => createWpsTemporaryPath(services, 'png'))
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); else delete globalThis.crypto
  }
})
