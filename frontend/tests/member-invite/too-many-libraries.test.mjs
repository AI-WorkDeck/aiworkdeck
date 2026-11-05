// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 问题 126 真机复测（dev-board#1713）：这台电脑连着 2 条云端连接时，「放进团队案件库」
// 一律被拒、提示「请先断开多余的」，但界面上根本没有断开的地方——死胡同。
// 现在两个弹窗就地列出这几条连接，每条一个「断开」（确认后调现有的
// POST /api/cloud/connections/{id}/disconnect）。不自动选、不自动断开。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  describeLibraryConnections, disconnectLibraryConnection, pickShareConnectionId,
} from '../../src/utils/cloudShare.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

test('列出每条连接的服务器、是否官方、我的身份、连接时间（用现有字段，不带令牌）', () => {
  const rows = describeLibraryConnections([
    { id: 7, serverUrl: 'https://case.aiworkdeck.com', username: 'awd_x', displayName: '韩律师', connectedAt: '2026-10-01T09:30:12.123' },
    { id: 8, serverUrl: 'https://case.workdeck.ai', username: 'awd_y', displayName: null, connectedAt: null },
  ], 'https://case.aiworkdeck.com')
  assert.deepEqual(rows, [
    { id: 7, server: 'case.aiworkdeck.com', official: true, who: '韩律师', connectedAt: '2026-10-01 09:30' },
    { id: 8, server: 'case.workdeck.ai', official: false, who: 'awd_y', connectedAt: '' },
  ])
})

test('地址解析不了时原样显示，不吞掉这一行', () => {
  const [row] = describeLibraryConnections([{ id: 9, serverUrl: 'not a url' }], null)
  assert.equal(row.server, 'not a url')
  assert.equal(row.official, false)
})

test('没确认就一次都不断开', async () => {
  const calls = []
  const res = await disconnectLibraryConnection({
    connectionId: 7, confirm: async () => false, disconnect: async (id) => { calls.push(id) },
  })
  assert.deepEqual(res, { ok: false })
  assert.deepEqual(calls, [])
})

test('确认后只断开选中的那一条；剩一条就能再放进去', async () => {
  const calls = []
  const res = await disconnectLibraryConnection({
    connectionId: 8, confirm: async () => true, disconnect: async (id) => { calls.push(id) },
  })
  assert.deepEqual(res, { ok: true })
  assert.deepEqual(calls, [8])
  assert.deepEqual(pickShareConnectionId([{ id: 7 }]), { ok: true, connectionId: 7 })
})

test('断开失败原样往外抛，由界面就地显示', async () => {
  await assert.rejects(
    () => disconnectLibraryConnection({ connectionId: 8, confirm: async () => true, disconnect: async () => { throw new Error('boom') } }),
    /boom/,
  )
})

const list = read('src/components/collab/LibraryConnectionList.vue')

test('连接列表组件：确认框写明本机文件不删、已入库案卷的影响，确认后调现有断开接口', () => {
  assert.match(list, /disconnectCloudConnection/)
  assert.match(list, /disconnectLibraryConnection\(/)
  assert.match(list, /uni\.showModal\(/)
  assert.match(list, /\$t\('version\.disconnectLibraryConfirm'/)
  assert.match(list, /emits: \['disconnected'\]/)
})

for (const file of ['src/components/collab/CollabDialog.vue', 'src/components/InviteMemberDialog.vue']) {
  const src = read(file)
  test(`${file}：多于一条连接被拒时就地列出连接（不再只闪一句 toast），断开后重读连接`, () => {
    assert.match(src, /<LibraryConnectionList/)
    assert.match(src, /@disconnected="onLibraryDisconnected"/)
    assert.doesNotMatch(src, /showToast\(\{ title: this\.\$t\('version\.tooManyLibraries'\)/)
    const handler = src.slice(src.indexOf('async onLibraryDisconnected()'))
    assert.ok(handler.length > 0)
    assert.doesNotMatch(handler.slice(0, 400), /shareProjectToLibrary|onShare/, '断开后不自动放进去，律师自己再点')
  })
}
