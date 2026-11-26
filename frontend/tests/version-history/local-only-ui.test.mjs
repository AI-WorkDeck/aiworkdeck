// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C12 UI: files kept on the sharer's computer are named after 交稿, badged in the tree, and a colleague's
// placeholder explains itself instead of trying to open bytes that are not there.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { noticeLocalOnly, resetLocalOnlyNotice } from '../../src/utils/localOnlyNotice.js'

const t = (k, p) => k + (p ? JSON.stringify(p) : '')
const tree = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')

test('after 交稿 the kept-local files are named once per set, with a button to turn on backup', () => {
  resetLocalOnlyNotice()
  const modals = []; let opened = 0
  const ui = { t, showModal: (o) => { modals.push(o); o.success({ confirm: true }) }, openBackup: () => opened++ }
  assert.equal(noticeLocalOnly(7, ['庭审录像.mp4'], ui), true)
  assert.match(modals[0].content, /localOnlyNoticeBody.*庭审录像\.mp4/)
  assert.equal(modals[0].confirmText, 'version.localOnlyNoticeAction')
  assert.equal(opened, 1, 'the action opens the cloud file backup dialog')
  assert.equal(noticeLocalOnly(7, ['庭审录像.mp4'], ui), false, 'same set: not again on every 交稿')
  assert.equal(noticeLocalOnly(7, ['庭审录像.mp4', '现场.mp4'], ui), true, 'a new file: say it again')
  assert.equal(noticeLocalOnly(7, [], ui), false)
  assert.equal(noticeLocalOnly(7, ['庭审录像.mp4'], ui), true, 'cleared when nothing is local-only any more')
})

function body(src, name) {
  // handleItemClick also survives as a commented-out older copy: take the live one (item, event).
  const start = src.search(new RegExp('^    (?:async )?' + name + (name === 'handleItemClick' ? '\\(item, event\\)' : '\\('), 'm'))
  assert.ok(start >= 0, name)
  return src.slice(start, src.indexOf('\n    },', start) + 7).trim().replace(/,$/, '')
}
const fn = (name, deps = {}) => vm.runInNewContext(`({${body(tree, name)}}).${name}`, deps)

test('tree badge: mine reads 仅在本机, a colleague placeholder names who has it', () => {
  const label = fn('localOnlyLabel')
  const v = { $t: t, localOnlyByFileId: { 1: { mine: true }, 2: { mine: false, sharedBy: '沈砚' }, 3: { mine: false, sharedBy: '' } } }
  assert.equal(label.call(v, { id: 1 }), 'fileTree.localOnlyMine')
  assert.equal(label.call(v, { id: 2 }), 'fileTree.localOnlyOther{"name":"沈砚"}')
  assert.equal(label.call(v, { id: 3 }), 'fileTree.localOnlyOtherUnknown')
  assert.equal(label.call(v, { id: 4 }), '')
})

test('double-clicking a colleague placeholder explains instead of opening; my own file opens normally', () => {
  const modals = []
  const explain = fn('explainLocalOnly', { uni: { showModal: (o) => modals.push(o) }, Date })
  const v = { $t: t, localOnlyByFileId: { 1: { mine: true }, 2: { mine: false, sharedBy: '沈砚' } },
    localOnlyLabel: (i) => 'label' + i.id, localOnlyTip: (i) => 'tip' + i.id }
  v.isColleaguePlaceholder = fn('isColleaguePlaceholder').bind(v)
  assert.equal(explain.call(v, { id: 2 }), true)
  assert.equal(modals[0].content, 'tip2')
  assert.equal(explain.call(v, { id: 1 }), false, 'the sharer still opens their own file')
  assert.equal(explain.call(v, { id: 9 }), false)
  assert.match(tree, /if \(item && !item\.isFolder && !this\.explainLocalOnly\(item\)\) this\.\$emit\('file-open', item\)/)
  assert.equal(tree.match(/class="tree-item-due is-local-only"/g).length, 2, 'both tree renderings show the badge')
})

test('a single click on a colleague placeholder selects and explains, never opens; a double-click explains once', () => {
  const modals = []
  const deps = { uni: { showModal: (o) => modals.push(o) }, Date, console }
  const v = { $t: t, localOnlyByFileId: { 2: { mine: false, sharedBy: '沈砚' }, 1: { mine: true } },
    localOnlyLabel: (i) => 'label' + i.id, localOnlyTip: (i) => 'tip' + i.id, multiSelectedIds: [], emitted: [] }
  v.$emit = (name, item) => v.emitted.push([name, item.id])
  v.isColleaguePlaceholder = fn('isColleaguePlaceholder', deps).bind(v)
  v.explainLocalOnly = fn('explainLocalOnly', deps).bind(v)
  const click = fn('handleItemClick', deps).bind(v)
  const placeholder = { id: 2, isFolder: false, parentId: null }
  click(placeholder, { metaKey: false, ctrlKey: false })
  assert.deepEqual(v.emitted, [], 'not opened (the player, 当前文档)')
  assert.equal(v.selectedFileId, 2, 'still selected')
  assert.equal(modals.length, 1)
  assert.equal(v.explainLocalOnly(placeholder), true, 'the dblclick that follows is still handled')
  assert.equal(modals.length, 1, 'but explained once')
  v.lastClickTime = 0
  modals.length = 0; v.localOnlyExplained = null
  click(placeholder)
  assert.equal(modals.length, 0, 'arrow keys pass over it silently')
  v.lastClickTime = 0
  click({ id: 1, isFolder: false, parentId: null }, { metaKey: false, ctrlKey: false })
  assert.deepEqual(v.emitted, [['file-select', 1]], 'the sharer opens their own file as before')
})

test('the badges follow the collaboration state, not only a window reload (lane C r3)', () => {
  // After 取回 wrote the colleague's recording the open window kept 「仅在沈砚的电脑上」 until a reload.
  const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const tabs = readFileSync(new URL('../../src/pages/project-overview/fileOpenTabs.js', import.meta.url), 'utf8')
  const collab = page.slice(page.indexOf('    async fetchCollabState('), page.indexOf('    recheckCollabIfStale('))
  assert.match(collab, /this\.collabCloud = \(res && res\.data\) \|\| null\n[\s\S]*this\.\$refs\?\.fileTree\?\.loadLocalOnly\?\.\(\)/,
    'every collaboration refresh (poll, after 取回 / 交稿) re-reads the badges')
  const reload = tabs.slice(tabs.indexOf('    async onVersionReloadFiles('), tabs.indexOf('\n    },', tabs.indexOf('    async onVersionReloadFiles(')))
  assert.match(reload, /this\.\$refs\?\.fileTree\?\.loadLocalOnly\?\.\(\)/, 'files rewritten by a version action re-read them too')
})

test('the 交稿 result and the tree read the local-only endpoints', () => {
  assert.match(api, /url: `\/api\/cloud\/projects\/\$\{projectId\}\/local-only`, method: 'GET'/)
  assert.match(api, /noticeLocalOnly\(projectId, d\.localOnlyFiles,/)
})
