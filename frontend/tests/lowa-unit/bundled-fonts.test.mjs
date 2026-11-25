// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// POLISH W6 step 2 (agreed with lane D): the web host may boot the editor with only the font
// categories a document needs (?fonts=…). Desktop passes no parameter and must get exactly the
// list it always had — byte-identical boot.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_FONTS, bundledFontsFor } from '../../src/zetaoffice/bundled-fonts.js'

const here = path.dirname(fileURLToPath(import.meta.url))

// The list editor-main.js inlined before this change (master 2026-11-25).
const DESKTOP_FONTS = [
  { url: './cjk.ttc', family: 'Noto Sans SC', category: 'sans' },
  { url: './cjk-serif.otf', family: 'Noto Serif SC', category: 'serif' },
  { url: './cjk-kai.ttf', family: '霞鹜文楷', category: 'kai' },
  { url: './cjk-fangsong.ttf', family: '朱雀仿宋（预览测试版）', category: 'fangsong' },
  { url: './cjk-kr.otf', family: 'Noto Sans KR', category: 'kr' },
  { url: './cjk-kr-serif.otf', family: 'Noto Serif KR', category: 'kr-serif' },
  { url: './cjk-thai.ttf', family: 'Noto Sans Thai', category: 'thai' },
  { url: './cjk-thai-serif.ttf', family: 'Noto Serif Thai', category: 'thai-serif' },
  { url: './cjk-khmer.ttf', family: 'Noto Sans Khmer', category: 'khmer' },
  { url: './cjk-lao.ttf', family: 'Noto Sans Lao', category: 'lao' },
  { url: './cjk-myanmar.ttf', family: 'Noto Sans Myanmar', category: 'myanmar' },
  { url: './cjk-arabic.ttf', family: 'Noto Sans Arabic', category: 'arabic' },
  { url: './cjk-devanagari.ttf', family: 'Noto Sans Devanagari', category: 'devanagari' },
]

test('without ?fonts the editor boots with the unchanged desktop font list, in order', () => {
  assert.deepEqual(bundledFontsFor(null), DESKTOP_FONTS)
  assert.deepEqual([...BUNDLED_FONTS], DESKTOP_FONTS)
})

test('?fonts= selects categories; empty means no bundled fonts; unknown names are ignored', () => {
  assert.deepEqual(bundledFontsFor('sans,serif').map(f => f.category), ['sans', 'serif'])
  assert.deepEqual(bundledFontsFor(' fangsong , kai ').map(f => f.category), ['kai', 'fangsong'])
  assert.deepEqual(bundledFontsFor(''), [])
  assert.deepEqual(bundledFontsFor('bogus,kai').map(f => f.category), ['kai'])
})

test('editor-main reads the parameter in one place and keeps system fonts after bundled ones', () => {
  const src = fs.readFileSync(path.resolve(here, '../../src/zetaoffice/editor-main.js'), 'utf8')
  assert.equal(src.match(/q\.get\('fonts'\)/g)?.length, 1)
  assert.match(src, /\.\.\.bundledFontsFor\(q\.get\('fonts'\)\),[\s\S]*?\.\.\.systemFonts,/)
  assert.doesNotMatch(src, /cjk-serif\.otf/, 'the font list lives only in bundled-fonts.js')
})
