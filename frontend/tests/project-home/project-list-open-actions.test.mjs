// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#1403: sidebar actions use the same native-open queue and save boundary as the File menu.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-dom'
import { createLocalOpenCoordinator } from '../../src/utils/localOpenCoordinator.js'
import zh from '../../src/locales/zh-CN/projects.js'
import en from '../../src/locales/en-US/projects.js'

const source = readFileSync(new URL('../../src/components/project-list/ProjectListPane.vue', import.meta.url), 'utf8')
const template = source.slice(source.indexOf('<template>') + 10, source.indexOf('\n<script>')).replace(/<\/template>\s*$/, '')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*\n/gm, '').replace('export default', 'return')
const flowSource = readFileSync(new URL('../../src/utils/ideOpen.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '')
const prop = (node, name, arg) => node.props?.find(p => p.name === name && (!arg || p.arg?.content === arg))
const elements = (node) => [node, ...(node.children || []).flatMap(elements)].filter(node => node.type === 1)
const nodes = elements(parse(template))

function fixture({ files = ['/synthetic/one.txt'], canceled = false, fail = false, leave = async () => true } = {}) {
  const dialogs = [], requests = [], events = [], toasts = []
  const uni = { showToast: v => toasts.push(v), showModal() {} }
  const host = { fs: { showOpenDialog: async options => { dialogs.push(options); return { filePaths: files, canceled } } } }
  let flows
  const createCoordinator = options => createLocalOpenCoordinator({ ...options, ready() {} })
  flows = new Function('openLocalProject', 'openLocalFile', 'host', 'uni', 't', 'createLocalOpenCoordinator',
    `${flowSource}\nreturn { openFolderFlow, openFileFlow, registerOpenWorkbench }`)(
    async payload => { requests.push(payload); return { data: { projectId: 2 } } },
    async payload => { requests.push(payload); if (fail) throw new Error('Cannot read file'); return { data: { projectId: 2, file: { id: payload.path } } } },
    host, uni, key => key, createCoordinator,
  )
  const destination = { projectId: 2, openFile: file => events.push(['file', file.id]) }
  flows.registerOpenWorkbench({ projectId: 1, async leaveWorkbench(url) {
    events.push(['save', url])
    if (await leave() === false) return false
    events.push(['saved'])
    flows.registerOpenWorkbench(destination)
    return true
  } })
  const component = new Function('openFolderFlow', 'openFileFlow', 'uni', 'InviteMemberDialog', 'CloudAcceptDialog', 'AwdSelect', 'AccountProjectCatalog', 'DEFAULT_SORT', script)(
    flows.openFolderFlow, flows.openFileFlow, uni, {}, {}, {}, {}, {},
  )
  const vm = { ...component.data(), ...component.methods, $t: key => key }
  return { vm, dialogs, requests, events, toasts }
}

test('desktop puts Open Folder first and primary, Open File second; web creation and client gate remain', () => {
  const section = nodes.find(n => prop(n, 'class')?.value?.content === 'create-section')
  assert.equal(prop(section, 'if').exp.content, '!isClientUser')
  const desktop = elements(section).find(n => prop(n, 'if')?.exp.content === 'isDesktop')
  const actions = elements(desktop).filter(n => prop(n, 'on', 'tap'))
  assert.deepEqual(actions.map(n => prop(n, 'on', 'tap').exp.content), ['onOpenFolder', 'onOpenFile'])
  assert.match(prop(actions[0], 'class').value.content, /create-card-primary/)
  for (const action of actions) {
    assert.equal(prop(action, 'role').value.content, 'button')
    assert.ok(action.props.some(p => p.name === 'on' && p.arg?.content === 'keydown' && p.modifiers.includes('enter')))
    assert.ok(prop(action, 'bind', 'aria-disabled'))
  }
  const web = elements(section).find(n => prop(n, 'else'))
  assert.equal(prop(web, 'on', 'tap').exp.content, 'goToNewProject')
  assert.ok(nodes.find(n => prop(n, 'on', 'tap')?.exp.content === 'openCloudAccept'))
  assert.ok(nodes.find(n => prop(n, 'if')?.exp.content === 'SHOW_CLOUD_ACCEPT && !isClientUser && projects.length > 0'))
})

test('Open File waits for existing editors to save, then opens each selected file without duplicate dialogs', async () => {
  let release
  const saving = new Promise(resolve => { release = resolve })
  const f = fixture({ files: ['/synthetic/one.txt', '/synthetic/two.txt'], leave: () => saving })
  const pending = f.vm.onOpenFile()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.vm.busy, true)
  assert.equal(f.vm.busyText, 'projects.busyOpeningFile')
  assert.deepEqual(f.events.map(e => e[0]), ['save'])
  await f.vm.onOpenFolder()
  await f.vm.onOpenFile()
  assert.equal(f.dialogs.length, 1)
  assert.deepEqual(f.dialogs[0].properties, ['openFile', 'multiSelections'])
  release(true)
  await pending
  assert.deepEqual(f.events.map(e => e[0]), ['save', 'saved', 'file', 'file'])
  assert.deepEqual(f.events.filter(e => e[0] === 'file').map(e => e[1]), ['/synthetic/one.txt', '/synthetic/two.txt'])
  assert.equal(f.vm.busy, false)
})

test('save refusal does not open a file or switch destination, and clears busy state', async () => {
  const f = fixture({ leave: async () => false })
  await f.vm.onOpenFile()
  assert.deepEqual(f.events.map(e => e[0]), ['save'])
  assert.equal(f.vm.busy, false)
})

test('Open Folder retains native directory creation and the save boundary', async () => {
  const f = fixture({ files: ['/synthetic/folder'] })
  await f.vm.onOpenFolder()
  assert.deepEqual(f.dialogs[0].properties, ['openDirectory', 'createDirectory'])
  assert.deepEqual(f.requests, [{ localRoot: '/synthetic/folder' }])
  assert.deepEqual(f.events.map(e => e[0]), ['save', 'saved'])
  assert.equal(f.vm.busy, false)
})

test('cancel leaves current project intact; failure reports the error and allows retry', async () => {
  const canceled = fixture({ canceled: true })
  await canceled.vm.onOpenFile()
  assert.deepEqual(canceled.requests, [])
  assert.deepEqual(canceled.events, [])
  assert.equal(canceled.vm.busy, false)
  const failed = fixture({ fail: true })
  await failed.vm.onOpenFile()
  assert.equal(failed.toasts[0].title, 'Cannot read file')
  assert.equal(failed.vm.busy, false)
  await failed.vm.onOpenFile()
  assert.equal(failed.dialogs.length, 2)
  assert.deepEqual(failed.events, [])
})

test('sidebar explanation and empty state are localized, with no removed creation instructions', () => {
  for (const locale of [zh, en]) {
    for (const key of ['listPurpose', 'busyOpeningFile', 'emptyHint']) assert.ok(locale[key])
  }
  assert.doesNotMatch(zh.emptyHint, /新建项目/)
})
