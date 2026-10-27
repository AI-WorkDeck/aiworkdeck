// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compile } from '@vue/compiler-dom'
import { parse as parseSfc } from 'vue/compiler-sfc'
import * as Vue from 'vue'

const source = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const ast = parse(parseSfc(source).descriptor.template.content)
const hasClass = (node, name) => node.type === 1 && node.props.some(p => p.name === 'class' && p.value?.content.split(' ').includes(name))
function find(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children || []) { const hit = find(child, predicate); if (hit) return hit }
}
const container = find(ast, n => hasClass(n, 'editors-container'))
const empty = find(container, n => hasClass(n, 'empty-workspace'))
const grid = find(container, n => hasClass(n, 'editors-grid'))
const left = find(grid, n => hasClass(n, 'pane-left'))
const right = find(grid, n => hasClass(n, 'pane-right'))
const spare = find(left, n => n.type === 1 && n.props.some(p => p.name === 'for' && p.exp?.content === 'sp in libreVisibleSpares'))
// Compile the real ancestors, conditions, keys and spare component. Unrelated
// editor branches are omitted so this is a mount test, not a whole-app mock.
const shell = (node, children) => node.loc.source.slice(0, node.loc.source.indexOf('>') + 1) + children + `</${node.tag}>`
const template = shell(container, empty.loc.source + shell(grid, shell(left, spare.loc.source) + shell(right, '')))
const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true, isCustomElement: tag => ['view', 'text', 'image'].includes(tag) }).code)(Vue)

function mount() {
  const nodes = (type, text = '') => ({ type, text, props: {}, children: [], parent: null })
  const remove = node => { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1) }
  const renderer = Vue.createRenderer({
    createElement: nodes, createText: text => nodes('#text', text), createComment: text => nodes('#comment', text),
    setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1],
    patchProp: (node, key, _, value) => { node.props[key] = value }, remove,
    insert(node, parent, anchor) { remove(node); node.parent = parent; const index = parent.children.indexOf(anchor); parent.children.splice(index < 0 ? parent.children.length : index, 0, node) },
  })
  const instances = [], removed = []
  const editor = Vue.defineComponent({
    props: ['file', 'active'], setup(props) {
      const instance = { uid: Vue.getCurrentInstance().uid, props }
      Vue.onMounted(() => instances.push(instance))
      Vue.onUnmounted(() => removed.push(instance.uid))
      return () => Vue.h('editor-stub')
    },
  })
  const noop = () => {}
  const state = Vue.reactive({
    leftFiles: [], splitMode: false, focusedPane: 'left', activeFileLeft: null,
    libreVisibleSpares: [{ key: 1, file: null }], projectId: 1, canWriteProject: true,
    isLooseWorkspace: false, hasProject: true, showWelcomeOnStartup: false,
    setLibreSpareRef: noop, onLibreSpareReady: noop, onLibreClose: noop,
    onLibreOpenUrl: noop, onOpenEvidenceTarget: noop, pushMenuState: noop,
    onEditorCommandProgress: noop, onEvidenceDrop: noop, onLocatorConsumed: noop,
    insightSubscribedFor: () => false, onOpenInsight: noop, onEditorCursorContext: noop,
    openCommitHistoryTab: noop, focusPane: noop, onWelcomeOpenFile: noop, onWelcomeOpenFolder: noop,
    openWelcomeTab() { state.leftFiles.push({ id: 'welcome' }) },
  })
  const root = nodes('root')
  const app = renderer.createApp({ components: { LibreOfficeEditor: editor }, setup: () => state, render })
  app.config.globalProperties.$t = s => s
  app.mount(root)
  const byClass = name => find(root, n => n.props?.class?.split(' ').includes(name))
  return { state, instances, removed, byClass, unmount: () => app.unmount() }
}

test('empty workbench mounts its spare and adopts the same component when a Word tab opens', async () => {
  const m = mount()
  try {
    assert.equal(m.instances.length, 1, 'a spare entry must mount before the first file click')
    assert.ok(m.byClass('empty-workspace'))
    assert.ok(m.byClass('editors-grid'))
    assert.ok(m.byClass('libre-spare-standby'))
    const first = m.instances[0], file = { id: 17, fileType: 'docx' }
    m.state.leftFiles.push(file); m.state.activeFileLeft = file; m.state.libreVisibleSpares[0].file = file
    await Vue.nextTick()
    assert.equal(m.instances.length, 1)
    assert.equal(m.instances[0].uid, first.uid)
    assert.equal(first.props.file.id, file.id)
    assert.equal(first.props.active, true)
    assert.equal(m.removed.length, 0)
    assert.equal(m.byClass('empty-workspace'), undefined)
    assert.equal(m.byClass('libre-spare-standby'), undefined)
  } finally { m.unmount() }
})

test('welcome open/close and split-mode changes preserve the mounted spare', async () => {
  const m = mount()
  try {
    const link = m.byClass('empty-welcome-link')
    link.props.onTap()
    await Vue.nextTick()
    assert.equal(m.instances.length, 1)
    m.state.leftFiles = []
    await Vue.nextTick()
    assert.equal(m.removed.length, 0, 'closing the last non-Word tab must not destroy the warm engine')
    assert.ok(m.byClass('empty-workspace'))
    m.state.splitMode = true
    await Vue.nextTick()
    assert.equal(m.byClass('empty-workspace'), undefined)
    assert.ok(m.byClass('pane-half'))
    assert.ok(m.byClass('pane-right'))
    m.state.splitMode = false
    await Vue.nextTick()
    assert.ok(m.byClass('pane-full'))
    assert.equal(m.byClass('pane-right'), undefined)
    assert.equal(m.instances.length, 1)
    assert.equal(m.removed.length, 0)
  } finally { m.unmount() }
})
