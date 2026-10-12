// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mergeMembers } from '../../src/utils/mergeMembers.js'

const source = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
function method(name, dependencies = {}) {
  const match = source.match(new RegExp(`\\n    async ${name}\\([^\\n]*\\) \\{\\n([\\s\\S]*?)\\n    \\},`))
  assert.ok(match, name)
  return new Function(...Object.keys(dependencies), `return async function() {${match[1]}}`)(...Object.values(dependencies))
}
const flush = () => new Promise(resolve => setImmediate(resolve))

for (const linked of [true, false]) {
  test(`首次打开项目等待协作状态，再加载${linked ? '本机和云端' : '本机'}成员`, async () => {
    let finishStatus
    let cloudReads = 0
    const status = new Promise(resolve => { finishStatus = resolve })
    const local = [{ id: 1, userId: 1, username: 'lawyer_a', accountId: 10, displayName: '本机用户' }]
    const cloud = [
      { id: 21, username: 'awd_lawyer_a', accountId: 10 },
      { id: 22, username: 'lawyer_b', accountId: 20, displayName: '律师乙' },
    ]
    const vm = {
      projectId: 12, projectInfoLoaded: false, isLooseWorkspace: false, hasNamedProject: true,
      projectMembers: [], collabCloud: null,
      get collabLinked() { return !!this.collabCloud?.linked },
      async fetchCollabState(options) {
        if (options?.online) return
        this.collabCloud = await status
      },
      checkAdoptConflict() {}, startCollabPolling() {},
      async ensureStagingFolder() {}, loadStagingFiles() {},
    }
    vm.loadProjectMembers = method('loadProjectMembers', {
      getProjectMembers: async () => ({ data: local }),
      getCloudMembers: async () => { cloudReads++; return { data: { members: cloud } } },
      mergeMembers,
    }).bind(vm)
    const load = method('loadProjectInfo', {
      getProject: async () => ({ id: 12, projectType: 'LOCAL' }),
      recordProjectVisit() {}, syncRecentToMenuFetching() {}, loadProjectTasks: async () => [],
    })
    // onShow 早于详情返回；它的预加载被守卫挡下，必须由正常初始化保证最终名单完整。
    await vm.loadProjectMembers()
    await load.call(vm)
    await flush()
    finishStatus({ linked })
    await flush()
    assert.equal(cloudReads, linked ? 1 : 0)
    assert.deepEqual(vm.projectMembers.map(member => member.username), linked ? ['lawyer_a', 'lawyer_b'] : ['lawyer_a'])
    assert.equal(vm.projectMembers[0].userId, 1)
    if (linked) assert.equal(vm.projectMembers[1].userId, null)
  })
}
