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
  const start = src.search(new RegExp('^    (?:async )?' + name + '\\(', 'm'))
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
  const explain = fn('explainLocalOnly', { uni: { showModal: (o) => modals.push(o) } })
  const v = { $t: t, localOnlyByFileId: { 1: { mine: true }, 2: { mine: false, sharedBy: '沈砚' } },
    localOnlyLabel: (i) => 'label' + i.id, localOnlyTip: (i) => 'tip' + i.id }
  assert.equal(explain.call(v, { id: 2 }), true)
  assert.equal(modals[0].content, 'tip2')
  assert.equal(explain.call(v, { id: 1 }), false, 'the sharer still opens their own file')
  assert.equal(explain.call(v, { id: 9 }), false)
  assert.match(tree, /if \(item && !item\.isFolder && !this\.explainLocalOnly\(item\)\) this\.\$emit\('file-open', item\)/)
  assert.equal(tree.match(/class="tree-item-due is-local-only"/g).length, 2, 'both tree renderings show the badge')
})

test('the 交稿 result and the tree read the local-only endpoints', () => {
  assert.match(api, /url: `\/api\/cloud\/projects\/\$\{projectId\}\/local-only`, method: 'GET'/)
  assert.match(api, /noticeLocalOnly\(projectId, d\.localOnlyFiles,/)
})
