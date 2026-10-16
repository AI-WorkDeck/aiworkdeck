// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Exercise the actual shared flow used by the welcome page, project list and native menu.
const source = readFileSync(new URL('../../src/utils/ideOpen.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '').replace(/^export /gm, '')
function fixture({ confirm = true, modalFails = false, nested = true, failRetry = false } = {}) {
  const requests = [], navigations = [], modals = []
  const openLocalProject = async payload => {
    requests.push(payload)
    if (nested && requests.length === 1) return { data: {
      requiresNestedConfirmation: true, overlappingProjectNames: ['父项目', '子项目'],
    } }
    if (failRetry) throw new Error('open failed')
    return { data: { projectId: 42 } }
  }
  const uni = { showModal(options) {
    modals.push(options)
    if (modalFails) options.fail()
    else options.success({ confirm })
  } }
  const host = { fs: { showOpenDialog: async () => ({ filePaths: ['/parent/child'] }) } }
  const coordinator = () => ({
    enqueue: action => action(), enter: async id => { navigations.push(id); return true },
  })
  const flows = new Function('openLocalProject', 'openLocalFile', 'host', 'uni', 't', 'createLocalOpenCoordinator',
    `${source}\nreturn { openFolderFlow, openLocalRootPath, createFolderFlow }`)(
    openLocalProject, () => {}, host, uni, (key, params) => ({ key, params }), coordinator)
  return { ...flows, requests, navigations, modals }
}

test('选择嵌套文件夹后，确认再次请求同一路径并进入所选项目', async () => {
  const f = fixture()
  assert.equal(await f.openFolderFlow(), true)
  assert.deepEqual(f.requests, [{ localRoot: '/parent/child' }, { localRoot: '/parent/child', allowNested: true }])
  assert.deepEqual(f.navigations, [42])
  assert.equal(f.modals[0].confirmText.key, 'common.nestedFolderContinue')
  assert.equal(f.modals[0].cancelText.key, 'common.cancel')
  assert.equal(f.modals[0].content.params.names, '父项目、子项目')
})

test('取消或弹框失败：不重试、不导航', async () => {
  for (const options of [{ confirm: false }, { modalFails: true }]) {
    const f = fixture(options)
    assert.equal(await f.openFolderFlow(), false)
    assert.equal(f.requests.length, 1)
    assert.deepEqual(f.navigations, [])
  }
})

test('新建子目录保留名称与创建标志，系统路径入口也可继续打开', async () => {
  const f = fixture()
  assert.equal(await f.createFolderFlow('/parent/', ' child '), true)
  assert.deepEqual(f.requests[1], { localRoot: '/parent/child', createFolder: true, name: 'child', allowNested: true })
  const native = fixture()
  assert.equal(await native.openLocalRootPath('/parent/child'), true)
  assert.equal(native.requests[1].allowNested, true)
})

test('无嵌套或已登记的项目直接打开；确认后失败仍由原入口报告', async () => {
  const normal = fixture({ nested: false })
  assert.equal(await normal.openFolderFlow(), true)
  assert.equal(normal.requests.length, 1)
  assert.equal(normal.modals.length, 0)
  const failed = fixture({ failRetry: true })
  await assert.rejects(failed.openFolderFlow(), /open failed/)
  assert.deepEqual(failed.navigations, [])
})
