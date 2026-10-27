// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { resolve } from 'node:path'
import { readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { baseCompile } from '@intlify/message-compiler'
import { SUPPORTED_LOCALE_CODES } from './src/locales/registry.js'
// Vite module IDs use forward slashes even when node:path resolves Windows paths.
const normalizePath = path => path.replace(/\\/g, '/')
const root = normalizePath(resolve(__dirname))
const panels = { search: 'components/SearchPanel.vue', desensitize: 'components/DesensitizePane.vue', 'litigation-visual': 'components/LitigationVisualPanel.vue', insight: '../plugin-app/insight/Panel.vue', voice: '../plugin-app/voice/Panel.vue', calendar: '../plugin-app/calendar/Panel.vue', favorites: '../plugin-app/favorites/Panel.vue', clipboard: '../plugin-app/clipboard/Panel.vue' }
const id = process.env.AWD_BUSINESS_PLUGIN
if (!panels[id]) throw new Error('Unknown business plugin: ' + id)
export default defineConfig({
  root: resolve(root, 'plugin-app'),
  base: './',
  define: { __BUSINESS_PLUGIN__: JSON.stringify(id) },
  plugins: [{
    name: 'business-plugin-import-boundary', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:business-messages') return '\0business-messages' },
    async load(moduleId) {
      if (moduleId !== '\0business-messages') return
      const compile = value => typeof value === 'string' ? '(' + baseCompile(value, { mode: 'normal' }).code + ')'
        : Array.isArray(value) ? '[' + value.map(compile).join(',') + ']'
          : value && typeof value === 'object' ? '{' + Object.entries(value).map(([key, child]) => JSON.stringify(key) + ':' + compile(child)).join(',') + '}' : JSON.stringify(value)
      const locales = {}
      for (const language of id === 'calendar' ? SUPPORTED_LOCALE_CODES : ['zh-CN', 'en-US']) {
        locales[language] = {}
        const dir = resolve(root, 'src/locales', language)
        for (const file of await readdir(dir)) if (file.endsWith('.js') && (['zh-CN', 'en-US'].includes(language) || file === 'calendar.js')) locales[language][file.slice(0, -3)] = (await import(pathToFileURL(resolve(dir, file)).href)).default
      }
      return 'export default ' + compile(locales)
    },
    transform(code, file) {
      file = normalizePath(file)
      if (!file.startsWith(root + '/') || !/\.(js|vue)(?:\?|$)/.test(file)) return
      return code.replace(/(['"])@\/([^'"\n]+)\1/g, (_match, quote, path) => {
        const voiceOverrides = { 'services/host.js': 'host.js', 'services/componentDownloads.js': 'componentDownloads.js', 'utils/meetingRecorder.js': 'meetingRecorder.js', 'utils/paidTranscribeGate.js': 'account.js', 'utils/requireAccount.js': 'account.js', 'utils/auth.js': 'account.js' }
        const target = id === 'insight' && path === 'services/contractReview.js' ? resolve(root, 'plugin-app/insight/api.js') : id === 'voice' && voiceOverrides[path] ? resolve(root, 'plugin-app/voice', voiceOverrides[path]) : /^services\/api(?:\.js)?$/.test(path) ? resolve(root, ['insight', 'voice', 'calendar', 'favorites', 'clipboard'].includes(id) ? 'plugin-app/' + id + '/api.js' : 'plugin-app/adapters/api.js')
          : /^i18n(?:\/index\.js)?$/.test(path) ? resolve(root, 'plugin-app/adapters/i18n.js') : resolve(root, 'src', path)
        return quote + normalizePath(target) + quote
      })
    },
    generateBundle(_options, bundle) {
      // Uni includes an unused remote pull-to-refresh decoration. Packaged
      // panels must not depend on a CDN or make requests outside the bridge.
      for (const item of Object.values(bundle)) {
        if (item.type === 'asset' && item.fileName.endsWith('.css')) {
          item.source = String(item.source).replace(/url\(["']?https:\/\/cdn\.dcloud\.net\.cn\/img\/shadow-grey\.png["']?\)/g, 'none')
        }
      }
    },
  }, uni()],
  resolve: { alias: [
    { find: 'vue-i18n', replacement: resolve(root, 'node_modules/vue-i18n/dist/vue-i18n.runtime.esm-bundler.js') },
    { find: '@/services/api.js', replacement: resolve(root, 'plugin-app/adapters/api.js') },
    { find: '@business-panel', replacement: resolve(root, 'src', panels[id]) },
    { find: '@plugin-sdk', replacement: resolve(root, '../sdk/plugin-sdk/awd-plugin-sdk.js') },
    { find: '@', replacement: resolve(root, 'src') },
  ] },
  build: { outDir: resolve(root, '../official-plugins', id, 'web'), emptyOutDir: true },
})
