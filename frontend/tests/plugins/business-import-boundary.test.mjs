// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { posix, win32 } from 'node:path'

// Execute the real config hook with each platform's path implementation. Uni
// compilation is covered by build:h5; these tests do not reproduce the rewrite.
const source = readFileSync(new URL('../../vite.business-plugins.config.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '').replace('export default defineConfig(', 'return defineConfig(')
function transform(platform, root, plugin) {
  const config = new Function('__dirname', 'resolve', 'process', 'defineConfig', 'uni', source)(
    root, platform.resolve, { env: { AWD_BUSINESS_PLUGIN: plugin } }, value => value, () => ({}))
  return config.plugins.find(item => item.name === 'business-plugin-import-boundary').transform
}
const plugins = ['search', 'voice', 'desensitize', 'litigation-visual', 'calendar', 'favorites', 'clipboard', 'insight']
for (const [label, platform, root] of [['Windows', win32, 'D:\\a\\AI WorkDeck\\frontend'], ['POSIX', posix, '/build/AI WorkDeck/frontend']]) {
  const normalized = root.replace(/\\/g, '/')
  const file = normalized + '/src/components/Panel.vue?vue&type=script&lang.js'
  test(label + ': all eight plugins use sandbox i18n and scoped API adapters', () => {
    for (const plugin of plugins) {
      const rewrite = transform(platform, root, plugin)
      for (const path of ['i18n', 'i18n/index.js']) {
        assert.equal(rewrite(`import messages from '@/${path}'`, file), `import messages from '${normalized}/plugin-app/adapters/i18n.js'`, plugin + ': ' + path)
      }
      const adapter = ['insight', 'voice', 'calendar', 'favorites', 'clipboard'].includes(plugin) ? plugin : 'adapters'
      for (const path of ['services/api', 'services/api.js']) {
        assert.equal(rewrite(`import * as api from "@/${path}"`, file), `import * as api from "${normalized}/plugin-app/${adapter}/api.js"`, plugin + ': ' + path)
      }
    }
  })
  test(label + ': voice host/account/recording and insight review cannot import host implementations', () => {
    const rewrite = transform(platform, root, 'voice')
    for (const [path, target] of Object.entries({ 'services/host.js': 'host.js', 'services/componentDownloads.js': 'componentDownloads.js', 'utils/meetingRecorder.js': 'meetingRecorder.js', 'utils/paidTranscribeGate.js': 'account.js', 'utils/requireAccount.js': 'account.js', 'utils/auth.js': 'account.js' })) {
      const input = `import bridge from '@/${path}'`
      const expected = `import bridge from '${normalized}/plugin-app/voice/${target}'`
      assert.equal(rewrite(input, file), expected)
      assert.equal(rewrite(input, platform.join(root, 'src/components/Panel.vue')), expected)
    }
    assert.equal(transform(platform, root, 'insight')('import review from "@/services/contractReview.js"', file), `import review from "${normalized}/plugin-app/insight/api.js"`)
  })
  test(label + ': ordinary source imports work without rewriting sibling directories or non-code files', () => {
    const rewrite = transform(platform, root, 'search')
    assert.equal(rewrite("import Icon from '@/components/Icon.vue'", file), `import Icon from '${normalized}/src/components/Icon.vue'`)
    for (const outside of [normalized + '-other/src/Panel.vue', normalized + '/src/style.css', '\0virtual:business-messages']) {
      assert.equal(rewrite("import api from '@/services/api.js'", outside), undefined)
    }
  })
}
