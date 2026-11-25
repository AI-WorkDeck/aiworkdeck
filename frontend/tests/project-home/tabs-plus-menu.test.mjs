// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D30: "+" at the end of the tab strip opens a menu (New Word / Excel / PowerPoint / browser tab) and never
// duplicates the open document; "Duplicate" stays in the explorer context menu.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const PO = fs.readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const method = (name) => {
  const at = PO.indexOf('\n    ' + name + '(') >= 0 ? PO.indexOf('\n    ' + name + '(') : PO.indexOf('\n    async ' + name + '(')
  assert.ok(at > 0, name)
  return PO.slice(at, PO.indexOf('\n    },\n', at) + 7)
}
const methods = new Function('createFile', 'uni', `return ({${method('onTabsPlusClick')}${method('onTabsPlusSelect')}${method('nextBlankOfficeName')}})`)

function host(over = {}) {
  const calls = []
  const createFile = async (pid, parent, name, type) => { calls.push(['create', pid, parent, name, type]); return { data: { id: 9, name } } }
  const uni = { showToast: (o) => calls.push(['toast', o.title]) }
  const vm = Object.assign(methods(createFile, uni), {
    projectId: 3, hasProject: true, splitMode: false, focusedPane: 'left',
    $t: (k) => ({ 'fileTree.defaultDocumentName': 'New document', 'fileTree.defaultSpreadsheetName': 'New workbook', 'fileTree.defaultPresentationName': 'New presentation' }[k] || k),
    $refs: {
      fileTree: { allFiles: [{ name: 'New workbook.xlsx', parentId: null }, { name: 'New document.docx', parentId: 5 }], files: [], loadFiles: async () => calls.push(['reload']) },
      tabsPlusMenu: { open: (o) => calls.push(['menu', !!o.anchor]) },
    },
    openBrowserTab: (url, pane) => calls.push(['web', url, pane]),
    openFile: (f) => calls.push(['open', f.name]),
    ensureScratchWorkspaceLoaded: async () => calls.push(['scratch']),
  }, over)
  return { vm, calls }
}

test('"+" opens the menu and does not copy anything', () => {
  const { vm, calls } = host()
  const el = { getBoundingClientRect: () => ({ left: 10, right: 38, bottom: 40 }) }
  vm.$el = { querySelector: (sel) => (sel === '.tabs-pane-left .tabs-plus' ? el : null) }
  vm.onTabsPlusClick('left', {})
  assert.deepEqual(calls, [['menu', true]])
  assert.doesNotMatch(PO, /batchCopyFiles/)
})

test('each Office item creates a blank file with a free name and opens it', async () => {
  const { vm, calls } = host()
  vm.onTabsPlusClick('left', {})
  await vm.onTabsPlusSelect('xlsx')
  assert.deepEqual(calls.filter((c) => c[0] === 'create')[0], ['create', 3, null, 'New workbook (2).xlsx', 'xlsx'])
  assert.ok(calls.some((c) => c[0] === 'open' && c[1] === 'New workbook (2).xlsx'))
  await vm.onTabsPlusSelect('docx')
  assert.ok(calls.some((c) => c[0] === 'create' && c[3] === 'New document.docx'), 'a same-named file in a subfolder does not count')
  await vm.onTabsPlusSelect('pptx')
  assert.ok(calls.some((c) => c[0] === 'create' && c[3] === 'New presentation.pptx'))
})

test('browser item opens a browser tab in the pane the "+" belongs to', async () => {
  const { vm, calls } = host({ splitMode: true })
  vm.onTabsPlusClick('right', {})
  await vm.onTabsPlusSelect('web')
  assert.deepEqual(calls.at(-1), ['web', undefined, 'right'])
})

test('no project open: the scratch workspace is prepared first', async () => {
  const { vm, calls } = host({ hasProject: false })
  await vm.onTabsPlusSelect('docx')
  assert.equal(calls[0][0], 'scratch')
})

test('both "+" buttons are labelled menu buttons; Duplicate is still in the explorer menu', () => {
  assert.equal((PO.match(/class="tabs-plus" role="button" tabindex="0" aria-haspopup="menu"/g) || []).length, 2)
  assert.doesNotMatch(PO, /workbench\.newOrCopy/)
  const tree = fs.readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
  assert.match(tree, /\$t\('fileTree\.duplicate'\)/)
})
