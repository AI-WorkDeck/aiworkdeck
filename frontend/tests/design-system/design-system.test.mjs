// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkStyles, checkTokenContract, run } from '../../../scripts/check-design-system.mjs'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const read = f => readFileSync(resolve(root, f), 'utf8')
const app = read('frontend/src/App.vue')
const theme = read('frontend/src/utils/appTheme.js')

// Check the guard itself with deliberate regressions, not just green source matching.
test('guard rejects independent hex, fallback colors, font and radius drift', () => {
  const errors = checkStyles('<style>.a { color: #fff; background: var(--old, rgba(0,0,0,.5)); font: 14px sans-serif; border-radius: 14px; outline-color: red; }</style>', 'fixture')
  assert.equal(errors.length, 5)
})
test('guard permits structural geometry and semantic values', () => {
  assert.deepEqual(checkStyles('<style>.a { width: 100%; max-height: 280px; border: 1px solid var(--awd-border); height: var(--awd-control-height); border-radius: 50%; }</style>', 'fixture'), [])
})
test('removing a metric from the iframe channel is detected', () => {
  assert.ok(checkTokenContract(app, theme.replace("'control-height',", '')).some(s => s.includes('missing iframe token: --awd-control-height')))
})
test('undefined and duplicate exported tokens are detected', () => {
  assert.ok(checkTokenContract(app, theme.replace("'bg',", "'missing-token', 'bg', 'bg',")).some(s => s.includes('undefined exported token')))
  assert.ok(checkTokenContract(app, theme.replace("'bg',", "'bg', 'bg',")).includes('duplicate exported token'))
})
test('current migrated shared controls and complete metric channel pass', () => assert.equal(run(), 0))

test('collectThemeTokens sends resolved metrics to the existing SDK channel', async () => {
  const { collectThemeTokens } = await import('data:text/javascript;base64,' + Buffer.from(theme).toString('base64'))
  const old = globalThis.window
  globalThis.window = { getComputedStyle: () => ({ getPropertyValue: n => ({ '--awd-control-height': '32px', '--awd-panel-row-h': '28px', '--awd-space-2': '8px' })[n] || '' }) }
  const oldDoc = globalThis.document
  globalThis.document = { documentElement: {} }
  try {
    const values = collectThemeTokens()
    assert.equal(values['--awd-control-height'], '32px')
    assert.equal(values['--awd-panel-row-h'], '28px')
    assert.equal(values['--awd-space-2'], '8px')
  } finally { globalThis.window = old; globalThis.document = oldDoc }
})

function component(name) {
  const source = read(`frontend/src/components/${name}.vue`)
  return new Function(source.match(/<script>([\s\S]*?)<\/script>/)[1].replace('export default', 'return'))()
}
test('switch respects disabled state and emits only the intended new boolean', () => {
  const { methods } = component('AwdSwitch')
  const events = []
  const ctx = { disabled: true, checked: false, $emit: (...e) => events.push(e) }
  methods.toggle.call(ctx)
  assert.deepEqual(events, [])
  ctx.disabled = false
  methods.toggle.call(ctx)
  assert.deepEqual(events, [['change', true]])
})
test('select keyboard arrows, commit and escape use existing selection/cancel paths', () => {
  const { methods } = component('AwdSelect')
  const actions = []
  const ctx = { range: ['A','B','C'], focusOption: i => actions.push(['focus',i]), pick: i => actions.push(['pick',i]), focusTrigger: () => actions.push(['trigger']), close: () => actions.push(['close']) }
  const key = (key, i) => methods.onOptionKey.call(ctx, { key, preventDefault() {} }, i)
  key('ArrowDown',2); key('ArrowUp',0); key('Enter',1); key('Escape',1)
  assert.deepEqual(actions, [['focus',0],['focus',2],['pick',1],['trigger'],['close'],['trigger']])
})
test('disabled select cannot open from keyboard', () => {
  const { methods } = component('AwdSelect')
  methods.onTriggerKey.call({ disabled: true }, { key: 'Enter', preventDefault() { throw Error('should not act') } })
})

test('domain speaker exception is confined to its original selector and exact values', () => {
  const file = 'frontend/src/components/MeetingRecordingPanel.vue'
  assert.deepEqual(checkStyles('<style>.sp-3 { background: #F5EBFF; color: #7A3FBF; }</style>', file), [])
  assert.equal(checkStyles('<style>.other { background: #F5EBFF; color: #7A3FBF; }</style>', file).length, 2)
  assert.equal(checkStyles('<style>.sp-3 { background: #fff; }</style>', file).length, 1)
})

test('named fonts are not colors; unknown awd references are rejected', () => {
  assert.deepEqual(checkStyles('<style>.a { font-family: Arial Black, sans-serif; }</style>', 'fixture'), [])
  assert.equal(checkStyles('<style>.a { color: var(--awd-typo); }</style>', 'fixture', new Set(['--awd-text'])).length, 1)
  assert.deepEqual(checkStyles('<style>.a { --awd-local: var(--awd-text); color: var(--awd-local); }</style>', 'fixture', new Set(['--awd-text'])), [])
})

test('switch thumb and track boundary maintain 3:1 contrast in light/dark and on/off states', () => {
  const css = read('frontend/src/components/AwdSwitch.vue').split('<style scoped>')[1]
  const palette = JSON.parse(read('design/tokens/awd-palette.json'))
  const block = selector => css.slice(css.indexOf(selector + ' {') + selector.length + 2).split('}')[0]
  const role = (selector, prop) => block(selector).match(new RegExp(prop + ':\\s*(?:1px solid )?var\\(--awd-([^)]*)\\)'))?.[1]
  function luminance(hex) {
    const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4)
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722
  }
  function contrast(a,b) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
  for (const mode of ['light','dark']) {
    const p = palette.roles[mode]
    const thumbOff = role('.awd-switch-knob','background'), thumbOn = role('.awd-switch.is-on .awd-switch-knob','background')
    const trackOff = role('.awd-switch::before','background'), trackOn = role('.awd-switch.is-on::before','background')
    assert.ok(contrast(p[thumbOff],p[trackOff]) >= 3, `${mode} off thumb`)
    assert.ok(contrast(p[thumbOn],p[trackOn]) >= 3, `${mode} on thumb`)
    const borderOff = role('.awd-switch::before','border'), borderOn = role('.awd-switch.is-on::before','border-color')
    assert.ok(contrast(p[borderOff],p.surface) >= 3, `${mode} off boundary`)
    assert.ok(contrast(p[borderOn],p.surface) >= 3, `${mode} on boundary`)
  }
})

test('plugin summary preserves only its existing on-accent host fallback', () => {
  const file = 'frontend/src/components/PluginWorkspaceSummary.vue'
  assert.deepEqual(checkStyles('<style>.plugin-summary-open { color: var(--awd-text-on-accent, #fff); }</style>', file), [])
  assert.equal(checkStyles('<style>.other { color: var(--awd-text-on-accent, #fff); }</style>', file).length, 1)
  assert.equal(checkStyles('<style>.plugin-summary-open { color: var(--awd-text-on-accent, #f00); }</style>', file).length, 1)
})
