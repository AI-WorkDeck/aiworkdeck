// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createBackendDescriptor } = require('../main/services/backend-service')

for (const packaged of [true, false]) test(`PDF font injection uses the ${packaged ? 'packaged' : 'development'} font and preserves overrides`, t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-pdf-font-'))
  const original = process.env.EXTERNAL_PDF_EDIT_CJK_FONT_PATH
  delete process.env.EXTERNAL_PDF_EDIT_CJK_FONT_PATH
  t.after(() => {
    if (original === undefined) delete process.env.EXTERNAL_PDF_EDIT_CJK_FONT_PATH
    else process.env.EXTERNAL_PDF_EDIT_CJK_FONT_PATH = original
    fs.rmSync(home, { recursive: true, force: true })
  })
  const ctx = { packaged, resourcesPath: path.join(home, 'resources'), projectRoot: path.join(home, 'project'), dataDir: path.join(home, 'data'), ports: { backend: 5269 } }
  const font = path.join(packaged ? ctx.resourcesPath : ctx.projectRoot, 'frontend/dist/zetaoffice/cjk-kai.ttf')
  const env = () => createBackendDescriptor().commands(ctx)[0].env
  assert.equal(env().EXTERNAL_PDF_EDIT_CJK_FONT_PATH, undefined)
  fs.mkdirSync(path.dirname(font), { recursive: true }); fs.writeFileSync(font, 'path fixture; real embedding is verified by PdfEditFontSafetyTest')
  assert.equal(env().EXTERNAL_PDF_EDIT_CJK_FONT_PATH, font)
  process.env.EXTERNAL_PDF_EDIT_CJK_FONT_PATH = path.join(home, 'explicit-font.ttf')
  assert.equal(env().EXTERNAL_PDF_EDIT_CJK_FONT_PATH, process.env.EXTERNAL_PDF_EDIT_CJK_FONT_PATH)
})
