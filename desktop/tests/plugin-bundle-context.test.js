// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createBackendDescriptor } = require('../main/services/backend-service')

test('desktop backend receives packaged plugin source and allocated OAuth callback port', () => {
  const ctx = { packaged: true, resourcesPath: '/tmp/awd-test-resources', projectRoot: '/tmp/awd-test-project', dataDir: '/tmp/awd-test-data', ports: { backend: 19742 }, appVersion: 'dev' }
  const command = createBackendDescriptor().commands(ctx)[0]
  assert.equal(command.env.AI_PLUGINS_BUNDLED_DIR, path.join(ctx.resourcesPath, 'official-plugins'))
  assert.equal(command.env.AI_PLUGINS_OAUTH_REDIRECT_URI, 'http://localhost:19742/api/plugins/oauth/callback')
})
test('development backend resolves plugin source from project checkout', () => {
  const ctx = { packaged: false, resourcesPath: '/tmp/awd-test-resources', projectRoot: '/tmp/awd-test-project', dataDir: '/tmp/awd-test-data', ports: { backend: 19743 }, appVersion: 'dev' }
  const command = createBackendDescriptor().commands(ctx)[0]
  assert.equal(command.env.AI_PLUGINS_BUNDLED_DIR, path.join(ctx.projectRoot, 'official-plugins'))
  assert.equal(command.env.AI_PLUGINS_OAUTH_REDIRECT_URI, 'http://localhost:19743/api/plugins/oauth/callback')
})
