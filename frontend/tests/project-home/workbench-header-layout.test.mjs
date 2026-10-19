// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCSS_PATH = path.resolve(HERE, '../../src/pages/project-overview/project-overview.scss')
const APP_VUE_PATH = path.resolve(HERE, '../../src/App.vue')

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/^\s*\/\/.*$/gm, '')
}

function getTopLevelBlock(css, selector, { includeNested = false } = {}) {
  const clean = stripComments(css)
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${escaped}\\s*\\{`, 'm')
  const match = re.exec(clean)
  assert.ok(match, `Missing top-level CSS block for ${selector}`)
  let depth = 0
  const start = match.index + match[0].length - 1
  let topBody = ''
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i]
    if (ch === '{') {
      depth++
      if (depth === 1) continue
    } else if (ch === '}') {
      depth--
      if (depth === 0) break
    }
    if (depth === 1 || includeNested) topBody += ch
  }
  return topBody
}

test('dev-board#1370: non-Windows .header-left bounds width before centered brand logo without clipping switcher dropdown', () => {
  const scss = fs.readFileSync(SCSS_PATH, 'utf8')
  const headerBlock = getTopLevelBlock(scss, '.project-header')
  assert.match(headerBlock, /--awd-header-pad-start:\s*max\(18px,\s*var\(--awd-titlebar-safe-inline-start\)\)/)
  assert.match(headerBlock, /--awd-header-pad-end:\s*max\(18px,\s*var\(--awd-titlebar-safe-inline-end\)\)/)

  const compactBlock = getTopLevelBlock(scss, '.page-project-overview', { includeNested: true })
  assert.match(compactBlock, /--awd-header-pad-start:\s*max\(16px,\s*var\(--awd-titlebar-safe-inline-start\)\)/)
  assert.match(compactBlock, /--awd-header-pad-end:\s*max\(16px,\s*var\(--awd-titlebar-safe-inline-end\)\)/)

  const leftBlock = getTopLevelBlock(scss, '.header-left')
  assert.match(leftBlock, /min-width:\s*0/)
  assert.match(
    leftBlock,
    /max-width:\s*calc\(50%\s*-\s*\(var\(--awd-header-pad-start\)\s*-\s*var\(--awd-header-pad-end\)\)\s*\/\s*2\s*-\s*64px\)/,
    '.header-left must stop before the centered 100px brand logo across Mac traffic-light and web paddings'
  )
  assert.doesNotMatch(leftBlock, /overflow\s*:\s*hidden/, '.header-left must not clip .switcher-menu dropdown')

  const infoBlock = getTopLevelBlock(scss, '.project-info')
  assert.match(infoBlock, /min-width:\s*0/)
  assert.doesNotMatch(infoBlock, /overflow\s*:\s*hidden/, '.project-info must not clip .switcher-menu dropdown')

  const titleRowBlock = getTopLevelBlock(scss, '.project-title-row')
  assert.match(titleRowBlock, /min-width:\s*0/)
  assert.doesNotMatch(titleRowBlock, /overflow\s*:\s*hidden/, '.project-title-row must not clip .switcher-menu dropdown')
})

test('dev-board#1370: collaboration chip and project meta shrink and ellipsize on 1440px English layout', () => {
  const scss = fs.readFileSync(SCSS_PATH, 'utf8')
  const chipBlock = getTopLevelBlock(scss, '.collab-chip')
  assert.match(chipBlock, /min-width:\s*0/)
  assert.match(chipBlock, /max-width:\s*220px/)
  assert.doesNotMatch(chipBlock, /flex-shrink:\s*0/)

  const chipTextBlock = getTopLevelBlock(scss, '.collab-chip-text')
  assert.match(chipTextBlock, /min-width:\s*0/)
  assert.match(chipTextBlock, /@include\s+text-ellipsis/)

  const metaBlock = getTopLevelBlock(scss, '.project-meta')
  assert.match(metaBlock, /min-width:\s*0/)
  assert.match(metaBlock, /overflow:\s*hidden/)
  assert.match(metaBlock, /text-overflow:\s*ellipsis/)

  const metaItemBlock = getTopLevelBlock(scss, '.meta-item')
  assert.match(metaItemBlock, /min-width:\s*0/)
  assert.match(metaItemBlock, /overflow:\s*hidden/)
  assert.match(metaItemBlock, /text-overflow:\s*ellipsis/)
})

test('dev-board#1370: Windows overrides .header-left max-width since .header-center logo is hidden', () => {
  const appVue = fs.readFileSync(APP_VUE_PATH, 'utf8')
  assert.match(appVue, /html\.is-win\s+\.project-header\s+\.header-center\s*\{\s*display:\s*none;\s*\}/)
  assert.match(
    appVue,
    /html\.is-win\s+\.project-header\s+\.header-left,\s*html\.is-win\s+\.project-header\s+\.project-info\s*\{[^}]*max-width:\s*none;/
  )
})
