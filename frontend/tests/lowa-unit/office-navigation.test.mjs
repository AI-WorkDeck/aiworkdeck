// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const methods = source.slice(source.indexOf('  office_get_navigation() {'), source.indexOf('  // [逐段溯源] 表格里的'))
function harness(kind = 'calc', { failExport = false, initialModified = false } = {}) {
  const sheets = Array.from({ length: 62 }, (_, i) => ({
    getName: () => '表' + i, getPropertyValue: () => i !== 2,
  }))
  const pages = Array.from({ length: 2 }, (_, i) => ({
    getName: () => '幻灯片' + (i + 1), getPropertyValue: k => ({ Number: i + 1, Width: 16000, Height: 9000 })[k],
  }))
  let active = 0, modified = initialModified, sourcePage, outputStream
  const changes = []
  const xModel = {
    getSheets: () => ({ getCount: () => sheets.length, getByIndex: i => sheets[i], hasByName: n => sheets.some(s => s.getName() === n), getByName: n => sheets.find(s => s.getName() === n) }),
    getDrawPages: () => ({ getCount: () => pages.length, getByIndex: i => pages[i] }),
    isModified: () => modified, setModified: value => { modified = value },
  }
  const ctrl = {
    getActiveSheet: () => sheets[active], setActiveSheet: sheet => { active = sheets.indexOf(sheet); changes.push(active) },
    getCurrentPage: () => pages[active], setCurrentPage: page => { active = pages.indexOf(page); changes.push(active) },
  }
  const sandbox = {
    xModel, ctrl, docSeq: 7, currentReviewRevision: () => 9, docKindOf: () => kind,
    isCalcDoc: () => kind === 'calc', isImpressDoc: () => kind === 'impress',
    unoSameDrawPage: (a, b) => a === b, errStr: String, slideFail: message => ({ success: false, message }),
    NOT_PRESENTATION_MSG: 'not presentation', exportInFlight: false,
    css: { io: { XOutputStream: {} }, beans: { PropertyValue: {} } },
    zetajs: { unoObject: (_, object) => object, Any: function (_, value) { return value }, type: { sequence: value => value, struct: value => value } },
    mkProp: (Name, Value) => ({ Name, Value }),
    context: { getServiceManager: () => ({ createInstanceWithContext: () => ({
      setSourceDocument: page => { sourcePage = page },
      filter: props => {
        assert.equal(sandbox.exportInFlight, true)
        modified = true
        if (failExport) throw Error('export failed')
        outputStream = props.find(p => p.Name === 'OutputStream').Value
        outputStream.writeBytes(new Uint8Array([137, 80, 78, 71]))
        return true
      },
    }) }) },
  }
  sandbox.EXEC = vm.runInNewContext(`({ ${methods} })`, sandbox)
  return { exec: sandbox.EXEC, changes, sandbox, sourcePage: () => sourcePage, modified: () => modified, pages }
}

test('all visible sheets are listed beyond 50 without exposing hidden sheets or changing selection', () => {
  const h = harness()
  const result = h.exec.office_get_navigation()
  assert.equal(result.items.length, 61)
  assert.equal(result.items.at(-1).id, '表61')
  assert.equal(result.items.some(item => item.id === '表2'), false)
  assert.equal(result.activeId, '表0')
  assert.equal(result.documentSeq, 7)
  assert.equal(result.revision, 9)
  assert.deepEqual(h.changes, [])
})

test('activation rejects stale documents and hidden sheets, then returns real selected identity', () => {
  const h = harness()
  assert.equal(h.exec.office_activate_item({ id: '表1', documentSeq: 6 }).success, false)
  assert.equal(h.exec.office_activate_item({ id: '表2', documentSeq: 7 }).success, false)
  assert.deepEqual(h.changes, [])
  assert.equal(h.exec.office_activate_item({ id: '表61', documentSeq: 7 }).activeId, '表61')
  assert.equal(h.modified(), false)
})

test('thumbnail renders the requested page without navigating or leaving modified state', () => {
  const h = harness('impress')
  const result = h.exec.slide_get_thumbnail({ slideNumber: 2, width: 240, documentSeq: 7 })
  assert.equal(result.success, true)
  assert.equal(result.width, 240)
  assert.equal(result.height, 135)
  assert.equal(result.documentSeq, 7)
  assert.equal(h.sourcePage(), h.pages[1])
  assert.equal(h.modified(), false)
  assert.equal(h.sandbox.exportInFlight, false)
  assert.deepEqual(h.changes, [])
  assert.equal(h.exec.slide_get_thumbnail({ slideNumber: 1.5, documentSeq: 7 }).success, false)
  assert.equal(h.exec.slide_get_thumbnail({ slideNumber: 1, documentSeq: 6 }).success, false)
})

test('failed thumbnail export restores flags and never changes the selected page', () => {
  const h = harness('impress', { failExport: true })
  assert.equal(h.exec.slide_get_thumbnail({ slideNumber: 2, documentSeq: 7 }).success, false)
  assert.equal(h.modified(), false)
  assert.equal(h.sandbox.exportInFlight, false)
  assert.deepEqual(h.changes, [])
})


test('thumbnail leaves an already modified document dirty', () => {
  const h = harness('impress', { initialModified: true })
  assert.equal(h.exec.slide_get_thumbnail({ slideNumber: 1, documentSeq: 7 }).success, true)
  assert.equal(h.modified(), true)
})
