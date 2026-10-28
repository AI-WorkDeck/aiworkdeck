// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { pptTarget, pptExpected, pptGeometry, pptShapeStyle, officePptShape } from './pptPrecision.js'
const source = readFileSync(new URL('./officeExecutor.js', import.meta.url), 'utf8')
function setup(supported = ['1.4', '1.5', '1.8', '1.10']) {
  const writes = []
  const shape = { id: 'shape', left: 10, top: 20, width: 100, height: 80, rotation: 0, load() {},
    fill: { clear: () => writes.push('clear'), setSolidColor: color => writes.push(color) }, lineFormat: {} }
  const slide = { id: 'slide', shapes: {items: [shape], load() {}},
    slideMaster: {layouts: {items: [{id: 'layout', name: 'Title'}], load() {}}},
    background: {fill: {setSolidFill: options => writes.push(options.color)}},
    applyLayout: layout => writes.push(layout.id), setSelectedShapes: ids => writes.push(ids) }
  const context = { presentation: { slides: {items: [slide], load() {}}, setSelectedSlides: ids => writes.push(ids) }, sync: async () => {} }
  const realm = vm.createContext({ t: key => key, pptTarget, pptExpected, pptGeometry, pptShapeStyle, officePptShape,
    requirePptTextApi: () => {}, pptApiSupported: version => supported.includes(version), PowerPoint: {run: async fn => fn(context)} })
  function command(name) {
    const start = source.indexOf(`  async ${name}(args) {`)
    const end = source.indexOf('\n  },', start) + 5
    return vm.runInContext(`({${source.slice(start, end)}}).${name}`, realm)
  }
  return { command, shape, writes }
}
test('Office geometry changes only supplied properties and reports actual values', async () => {
  const s = setup()
  const out = await s.command('ppt_set_shape_geometry')({slideNumber: 1, shapeId: 'shape', left: 50, width: 200})
  assert.equal(s.shape.left, 50); assert.equal(s.shape.top, 20); assert.equal(s.shape.height, 80)
  assert.equal(out.before.left, 10); assert.equal(out.after.width, 200)
  await assert.rejects(s.command('ppt_set_shape_geometry')({slideNumber: 1, shapeId: 'shape', left: 99, width: 0}))
  assert.equal(s.shape.left, 50)
})
test('Office style preflights the entire request before changing fill', async () => {
  const s = setup()
  await assert.rejects(s.command('ppt_format_shape')({slideNumber: 1, shapeId: 'shape', fillColor: '#123456', lineWidth: -1}))
  assert.equal(s.writes.length, 0)
  await s.command('ppt_format_shape')({slideNumber: 1, shapeId: 'shape', fillColor: '#123456', noLine: true})
  assert.deepEqual(s.writes, ['#123456']); assert.equal(s.shape.lineFormat.visible, false)
})
test('Office background requirement is checked before applying layout', async () => {
  const s = setup(['1.4', '1.8'])
  await assert.rejects(s.command('ppt_set_layout')({slideNumber: 1, layoutId: 'layout', backgroundColor: '#123456'}))
  assert.equal(s.writes.length, 0)
})
test('Office layout and background are independent; missing layout refuses all writes', async () => {
  const s = setup()
  await s.command('ppt_set_layout')({slideNumber: 1, backgroundColor: '#123456'})
  assert.deepEqual(s.writes, ['#123456'])
  await assert.rejects(s.command('ppt_set_layout')({slideNumber: 1, layoutId: 'missing', backgroundColor: '#ffffff'}))
  assert.deepEqual(s.writes, ['#123456'])
})
test('Office navigation verifies shape before changing selected slide', async () => {
  const s = setup()
  await assert.rejects(s.command('ppt_goto')({slideNumber: 1, shapeId: 'missing'}))
  assert.equal(s.writes.length, 0)
  await s.command('ppt_goto')({slideNumber: 1, shapeId: 'shape'})
  assert.equal(s.writes[0][0], 'slide'); assert.equal(s.writes[1][0], 'shape')
})
