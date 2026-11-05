// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 壳崩溃后后端 JVM 会残留；壳把自己的 pid 经 AWD_PARENT_PID 告诉后端，后端据此自行退出。
const test = require('node:test')
const assert = require('node:assert/strict')

test('backend spawn env carries the shell pid as AWD_PARENT_PID', () => {
  const { createBackendDescriptor } = require('../main/services/backend-service')
  const ctx = { packaged: false, projectRoot: '/isolated', ports: { backend: 1 } }
  const env = createBackendDescriptor().commands(ctx)[0].env
  assert.equal(env.AWD_PARENT_PID, String(process.pid))
})
