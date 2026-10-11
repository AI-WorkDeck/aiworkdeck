// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Incremental guard: only migrated surfaces are blocking; legacy surfaces remain an audit.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED_CONTROLS = ['AwdSelect.vue', 'AwdSwitch.vue', 'AwdDialog.vue']
export const MIGRATED_FILES = [...SHARED_CONTROLS, 'ProjectFavoritesPanel.vue', 'VariablePanel.vue', 'ClipboardPanel.vue', 'EasyVoicePane.vue', 'DdFilesPanel.vue', 'SearchPanel.vue', 'FileTree.vue', 'MeetingRecordingPanel.vue', 'MarketSidebarPanel.vue', 'PluginDevPanel.vue', 'PluginWorkspaceSummary.vue'].map(f => `frontend/src/components/${f}`)

export function checkStyles(source, filename, definedTokens) {
  const failures = []
  const localTokens = new Set([...source.matchAll(/(--awd-[\w-]+)\s*:/g)].map(m => m[1]))
  for (const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    // Declaration scanner supports nested SCSS rules; avoid installing the frontend in the lightweight CI job.
    const css = match[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*/gm, '')
    for (const declaration of css.matchAll(/(?:^|[;{}])\s*([-\w]+)\s*:\s*([^;{}]+)/g)) {
      const [, prop, value] = declaration
      if (definedTokens) {
        for (const ref of value.matchAll(/var\(\s*(--awd-[\w-]+)/g)) {
          if (!definedTokens.has(ref[1]) && !localTokens.has(ref[1])) failures.push(`${filename}: unknown token ${ref[1]}`)
        }
      }
      if (prop.startsWith('--')) continue
      const colorProperty = /(?:^|-)(?:color|background|border|shadow|outline|fill|stroke)(?:-|$)/.test(prop)
      const color = colorProperty && /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(|\b(?:white|black|red|blue|green)\b/i.test(value)
      const sizing = /^(?:border-radius|font-size|font)$/.test(prop) && /(?:\d*\.)?\d+(?:px|rem)\b/.test(value)
      // Round count badges are structural pills, not rounded content cards.
      const pill = prop === 'border-radius' && /^(?:99|999)px\s*$/.test(value.trim())
      // Media previews, glyphs and dock tiles keep their content geometry. Shared controls have no such exception.
      const controlHeight = SHARED_CONTROLS.some(f => filename.endsWith(f)) && /^(?:min-)?height$/.test(prop) && /\d+(?:px|rem)\b/.test(value)
      // Narrow legacy/domain exceptions: FileTree's two text glyphs; recording timer;
      // speaker slot 3 must match media/speakerColors.js until a coordinated palette migration.
      const context = css.slice(0, declaration.index + (declaration[0].startsWith('{') ? 1 : 0))
      const selector = context.match(/([^{}]+)\{[^{}]*$/)?.[1].trim()
      const domainException = (filename.endsWith('/FileTree.vue') && ['.folder-icon', '.new-folder-btn .btn-plus'].includes(selector) && prop === 'font-size' && value.trim() === '18px')
        || (filename.endsWith('/MeetingRecordingPanel.vue') && ((selector === '.mr-live-time' && prop === 'font-size' && value.trim() === '20px')
          || (selector === '.sp-3' && ((prop === 'background' && value.trim() === '#F5EBFF') || (prop === 'color' && value.trim() === '#7A3FBF')))))
      // Existing on-accent fallback remains usable before host theme tokens arrive.
      const hostFallback = filename.endsWith('/PluginWorkspaceSummary.vue') && selector === '.plugin-summary-open'
        && prop === 'color' && /^var\(--awd-text-on-accent,\s*#fff\)$/i.test(value.trim())
      if (!domainException && !hostFallback && (color || (sizing && !pill) || controlHeight)) failures.push(`${filename}: ${prop}: ${value.trim()}`)
    }
  }
  return failures
}

export function checkTokenContract(app, theme) {
  const definitions = new Set([...app.matchAll(/(--awd-[\w-]+)\s*:/g)].map(m => m[1]))
  const namesSource = theme.match(/export const THEME_TOKEN_NAMES = \[([\s\S]*?)\n\]/)?.[1] || ''
  const names = [...namesSource.replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)].map(m => '--awd-' + m[1])
  const failures = names.filter(n => !definitions.has(n)).map(n => `undefined exported token: ${n}`)
  if (new Set(names).size !== names.length) failures.push('duplicate exported token')
  for (const n of definitions) {
    if (/^--awd-(?:space-|control-height|radius-|font-size-|line-height-|focus-|motion-|switch-|panel-|font-(?:serif|sans|mono))/.test(n) && !names.includes(n)) failures.push(`missing iframe token: ${n}`)
  }
  return failures
}

export function run() {
  const app = readFileSync(resolve(root, 'frontend/src/App.vue'), 'utf8')
  const definedTokens = new Set([...app.matchAll(/(--awd-[\w-]+)\s*:/g)].map(m => m[1]))
  const failures = MIGRATED_FILES.flatMap(f => checkStyles(readFileSync(resolve(root, f), 'utf8'), f, definedTokens))
  failures.push(...checkTokenContract(readFileSync(resolve(root, 'frontend/src/App.vue'), 'utf8'), readFileSync(resolve(root, 'frontend/src/utils/appTheme.js'), 'utf8')))
  if (failures.length) { console.error(failures.join('\n')); return 1 }
  console.log(`Design system guard passed (${MIGRATED_FILES.length} migrated surfaces; theme export contract).`)
  return 0
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run()
