// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureAddinDefaultProject } from './api.js'
test('reused default project preserves typed identity without relying on its old name', async () => {
 const previous = globalThis.fetch
 globalThis.fetch = async () => ({ ok: true, json: async () => ({ created: false, project: { id: 17, name: 'old name', projectType: 'SCRATCH' } }) })
 try {
  const result = await ensureAddinDefaultProject({ serverUrl: 'https://example.test', token: 'test' })
  assert.equal(result.id, 17)
  assert.equal(result.projectType, 'SCRATCH')
 } finally { globalThis.fetch = previous }
})
