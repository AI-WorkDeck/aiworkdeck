// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// office-tier1 O8：PPT/Excel 上引擎回 available:false 后，逐键编辑不再排 get_review_layout；换文档复位。
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { attachReviewBalloons } from '../../src/composables/zetaOfficeReviewBalloons.js'

const wait = ms => new Promise(r => setTimeout(r, ms))

test('layout polling stops on a document without review geometry and resumes after a new load', async () => {
  const dom = new JSDOM('<!doctype html><body><canvas id="qtcanvas"></canvas></body>', { pretendToBeVisual: true })
  const canvas = dom.window.document.getElementById('qtcanvas')
  const calls = []
  let available = false
  const balloons = attachReviewBalloons({
    canvas, locale: 'zh', transport: { send() {} },
    execute: async (action) => {
      calls.push(action)
      if (action === 'get_review_layout') return available ? { success: true, available: true, items: [], pages: [], view: { left: 0, top: 0, right: 100, bottom: 100 } } : { success: true, available: false, items: [], pages: [] }
      return { success: true }
    },
  })
  const layoutReads = () => calls.filter(a => a === 'get_review_layout').length

  balloons.documentChanged()
  await wait(400)
  assert.equal(layoutReads(), 1, 'first edit probes once')

  for (let i = 0; i < 5; i++) {
    balloons.suspend('native_keys'); balloons.resume(); balloons.documentChanged(); balloons.cursorMoved()
  }
  await wait(400)
  assert.equal(layoutReads(), 1, 'keystrokes on an unsupported document must not queue layout reads')

  available = true
  balloons.suspend('load_document'); balloons.resume()
  await wait(50)
  assert.equal(layoutReads(), 2, 'a new document is probed again')
  balloons.destroy()
  dom.window.close()
})
