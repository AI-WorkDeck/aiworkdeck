// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/AwdSelect.vue', import.meta.url), 'utf8')
const component = new Function(source.match(/<script>([\s\S]*?)<\/script>/)[1].replace('export default', 'return'))()
function select(overrides = {}) {
  const events = [], focus = []
  const defaults = Object.fromEntries(Object.entries(component.props).map(([name, prop]) => [name, typeof prop.default === 'function' ? prop.default() : prop.default]))
  const vm = { ...defaults, ...component.data(), ...component.methods,
    range: ['Amber', '晓晓 Mandarin', 'Alba', '晓辰 Mandarin'], value: 0,
    $emit: (...args) => events.push(args), $nextTick: fn => fn(),
    $el: { querySelectorAll: () => vm.filteredOptions.map((_, position) => ({ focus: () => focus.push(position) })),
      querySelector: selector => ({ focus: () => focus.push(selector) }) },
    detachDismiss() {}, attachDismiss() {}, placeMenu() {}, ...overrides }
  for (const [name, getter] of Object.entries(component.computed)) Object.defineProperty(vm, name, { get: () => getter.call(vm) })
  const key = (method, key, position) => {
    let prevented = false
    vm[method]({ key, preventDefault() { prevented = true } }, position)
    return prevented
  }
  return { vm, events, focus, key }
}

test('search is opt-in; default select keeps all options and original keyboard indices', () => {
  const h = select()
  assert.equal(h.vm.searchable, false)
  assert.equal(h.vm.searchPlaceholder, '')
  assert.equal(h.vm.searchLabel, '')
  assert.equal(h.vm.emptyText, '')
  h.vm.searchQuery = 'does not match'
  assert.deepEqual(h.vm.filteredOptions.map(option => option.index), [0, 1, 2, 3])
  h.key('onTriggerKey', 'ArrowUp')
  assert.equal(h.vm.open, true)
  assert.equal(h.focus.at(-1), 3)
  h.key('onOptionKey', 'ArrowDown', 3)
  assert.equal(h.focus.at(-1), 0)
  h.key('onOptionKey', 'Enter', 2)
  assert.deepEqual(h.events, [['change', 2]])
  assert.equal(h.vm.open, false)
})

test('filtered navigation uses visible positions while Enter and Space emit original array indices', () => {
  const h = select({ searchable: true })
  h.vm.open = true
  h.vm.onSearchInput({ detail: { value: '晓' }, target: { value: 'stale' } })
  assert.deepEqual(h.vm.filteredOptions.map(option => option.index), [1, 3])
  h.key('onOptionKey', 'ArrowDown', 0)
  h.key('onOptionKey', 'ArrowDown', 1)
  h.key('onOptionKey', 'ArrowUp', 0)
  h.key('onOptionKey', 'Home', 1)
  h.key('onOptionKey', 'End', 0)
  assert.deepEqual(h.focus, [1, 0, 1, 0, 1])
  h.key('onOptionKey', 'Enter', 1)
  assert.deepEqual(h.events, [['change', 3]])
  h.vm.open = true
  h.key('onOptionKey', ' ', 0)
  assert.deepEqual(h.events, [['change', 3], ['change', 1]])
})

test('search input retains Space and Home/End editing and moves arrows into filtered results', () => {
  const h = select({ searchable: true })
  h.vm.open = true
  h.vm.onSearchInput({ target: { value: '晓晓 Mandarin' } })
  for (const key of [' ', 'Home', 'End']) assert.equal(h.key('onSearchKey', key), false)
  assert.deepEqual(h.events, [])
  assert.equal(h.vm.searchQuery, '晓晓 Mandarin')
  h.vm.onSearchInput({ detail: { value: 'mandarin' } })
  h.key('onSearchKey', 'ArrowDown'); h.key('onSearchKey', 'ArrowUp')
  assert.deepEqual(h.focus, [0, 1])
  assert.equal(h.key('onSearchKey', 'Enter'), true)
  assert.deepEqual(h.events, [['change', 1]])
})

test('empty search does not select an option; Escape/Tab close and only Escape restores trigger focus', () => {
  const h = select({ searchable: true })
  h.vm.open = true
  h.vm.onSearchInput({ detail: { value: '不存在' } })
  assert.deepEqual(h.vm.filteredOptions, [])
  h.key('onSearchKey', 'ArrowDown'); h.key('onSearchKey', 'ArrowUp'); h.key('onSearchKey', 'Enter')
  assert.deepEqual(h.events, [])
  assert.deepEqual(h.focus, [])
  assert.equal(h.key('onSearchKey', 'Escape'), true)
  assert.equal(h.vm.open, false)
  assert.deepEqual(h.events, [['cancel']])
  assert.deepEqual(h.focus, ['.awd-select-trigger'])
  h.vm.open = true
  assert.equal(h.key('onSearchKey', 'Tab'), false)
  assert.equal(h.vm.open, false)
  assert.deepEqual(h.events, [['cancel'], ['cancel']])
  assert.deepEqual(h.focus, ['.awd-select-trigger'])
})

test('opening searchable select focuses the input and clears the previous query; IME Enter does not commit', () => {
  const h = select({ searchable: true, searchQuery: 'old' })
  h.vm.$el.querySelector = selector => selector === '.awd-select-search-input'
    ? { querySelector: () => ({ focus: () => h.focus.push('native-input') }) }
    : null
  h.vm.openMenu()
  assert.equal(h.vm.searchQuery, '')
  assert.deepEqual(h.focus, ['native-input'])
  h.vm.onSearchKey({ key: 'Enter', isComposing: true, preventDefault() { throw Error('IME must remain in control') } })
  assert.deepEqual(h.events, [])
  h.vm.disabled = true
  h.vm.close()
  h.key('onTriggerKey', 'Enter')
  assert.equal(h.vm.open, false)
})

test('search menu fits a narrow viewport and flips above; non-search layout retains original min-width', () => {
  const oldWindow = globalThis.window
  globalThis.window = { innerHeight: 300, innerWidth: 200 }
  try {
    const h = select({ searchable: true })
    h.vm.$el.querySelector = () => ({ getBoundingClientRect: () => ({ left: 100, width: 160, top: 250, bottom: 282 }) })
    component.methods.placeMenu.call(h.vm)
    assert.deepEqual(h.vm.menuStyle, { left: '36px', width: '160px', bottom: '54px' })
    h.vm.searchable = false
    component.methods.placeMenu.call(h.vm)
    assert.deepEqual(h.vm.menuStyle, { left: '100px', minWidth: '160px', bottom: '54px' })
    h.vm.searchable = true
    h.vm.$el.querySelector = () => ({ getBoundingClientRect: () => ({ left: 0, width: 320, top: 0, bottom: 32 }) })
    component.methods.placeMenu.call(h.vm)
    assert.deepEqual(h.vm.menuStyle, { left: '4px', width: '192px', top: '36px' })
  } finally { globalThis.window = oldWindow }
  assert.match(source, /awd-select-menu\.is-searchable \.awd-select-item \{ white-space: normal/)
  assert.match(source, /awd-select-item-text \{ min-width: 0; overflow-wrap: anywhere/)
})


test('Enter and arrows use the current native input even if Uni still reports the preceding query', () => {
  for (const key of ['Enter', 'ArrowDown', 'ArrowUp']) {
    const h = select({ searchable: true })
    h.vm.open = true
    h.vm.onSearchInput({ detail: { value: '晓' } })
    // The user's second input is native already, but its throttled Uni event has not arrived.
    h.vm.onSearchKey({ key, target: { value: '晓辰' }, preventDefault() {} })
    assert.equal(h.vm.searchQuery, '晓辰')
    assert.deepEqual(h.vm.filteredOptions.map(option => option.index), [3])
    if (key === 'Enter') assert.deepEqual(h.events, [['change', 3]])
    else {
      assert.deepEqual(h.focus, [0])
      h.key('onOptionKey', 'Enter', 0)
      assert.deepEqual(h.events, [['change', 3]])
    }
  }
})

test('the actual input receives its search label on focus and after a locale update', () => {
  const h = select({ searchable: true, searchLabel: '搜索音色', ariaLabel: '说话人' })
  const attributes = {}, input = { setAttribute: (name, value) => { attributes[name] = value }, focus: () => h.focus.push('native-input') }
  h.vm.$el.querySelector = () => ({ querySelector: () => input })
  h.vm.openMenu()
  assert.equal(attributes['aria-label'], '搜索音色')
  assert.deepEqual(h.focus, ['native-input'])
  h.vm.searchLabel = 'Search voices'
  component.updated.call(h.vm)
  assert.equal(attributes['aria-label'], 'Search voices')
  h.vm.searchLabel = ''
  h.vm.ariaLabel = 'Speaker'
  component.updated.call(h.vm)
  assert.equal(attributes['aria-label'], 'Speaker')
  assert.deepEqual(h.focus, ['native-input'], 'locale changes must not steal focus')
  assert.match(source, /:deep\(\.uni-input-placeholder\)[^}]+var\(--awd-text-2\)/)
})


test('rapid-input arrow navigation waits until the filtered option DOM is rendered', () => {
  const pending = []
  const h = select({ searchable: true, $nextTick: fn => pending.push(fn) })
  h.vm.onSearchInput({ detail: { value: '晓' } })
  h.vm.onSearchKey({ key: 'ArrowDown', target: { value: '晓辰' }, preventDefault() {} })
  assert.deepEqual(h.focus, [], 'do not focus the previous result set before the render')
  assert.deepEqual(h.vm.filteredOptions.map(option => option.index), [3])
  pending.shift()()
  assert.deepEqual(h.focus, [0])
})


test('Uni input does not blur when the opening Enter keyup arrives after focus moves from the trigger', () => {
  // Uni input defaults to blur on Enter keyup unless confirmHold is enabled. The
  // trigger opens on keydown, so the paired keyup can arrive at the new input.
  const input = source.match(/<input\s+class="awd-select-search-input"[^>]*>/)?.[0]
  assert.match(input, /:confirm-hold="true"/)
  const h = select({ searchable: true })
  h.vm.$el.querySelector = () => ({ querySelector: () => null, focus: () => h.focus.push('native-input') })
  for (let attempt = 0; attempt < 2; attempt++) {
    h.key('onTriggerKey', 'Enter')
    assert.equal(h.vm.open, true)
    assert.equal(h.focus.at(-1), 'native-input')
    h.vm.close()
  }
})
