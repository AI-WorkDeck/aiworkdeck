// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 教程第 11 集（0.78.0 走查）：改名（0.78 之前会换令牌）之后案卷卡在「请明确重新连接云端」，
// 点「重新连接云端」后端照旧复用那枚已被撤掉的令牌，重放的放进案件库原样失败、界面像没反应。
// 现在：按钮走明确重连接口（真的换新令牌）；重连过还被拒换一句话说明；只剩一条连接也列出来能断开；
// 已入库仍卡住的案卷给「重新绑定这份案卷」——确认后先拆本机绑定、再放进去一次。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  reconnectRequiredMessage,
} from '../../src/utils/cloudShare.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const t = (k) => `t:${k}`

test('重连过还被门禁拒：换一句话，不再原样重显「请重新连接」', () => {
  const e = { kind: 'CLOUD_RECONNECT_REQUIRED', message: '云端同步权限已变化。请明确重新连接云端后再同步' }
  assert.equal(reconnectRequiredMessage(e, false, t), e.message)
  assert.equal(reconnectRequiredMessage(e, true, t), 't:version.reconnectDidNotHelp')
  assert.equal(reconnectRequiredMessage({ kind: 'CLOUD_RECONNECT_REQUIRED' }, false, t), 't:version.shareToLibraryFailed')
})

test('api.js：明确重连走自己的端点，默认的一键连接不变', () => {
  const api = read('src/services/api.js')
  assert.match(api, /export function reconnectOfficialCloud\(\) \{\s*return request\(\{ url: '\/api\/cloud\/reconnect-official', method: 'POST' \}\)/)
  assert.match(api, /export function connectOfficialCloud\(\) \{\s*return request\(\{ url: '\/api\/cloud\/connect-official', method: 'POST' \}\)/)
})

for (const file of ['src/components/collab/CollabDialog.vue', 'src/components/InviteMemberDialog.vue']) {
  const src = read(file)
  test(`${file}：「重新连接云端」调明确重连接口，重放仍被拒时换一句话`, () => {
    const body = src.slice(src.indexOf('async onReconnectCloud()'))
    assert.match(body.slice(0, 900), /await reconnectOfficialCloud\(\)/)
    assert.doesNotMatch(body.slice(0, 900), /[^e]connectOfficialCloud\(\)/, '默认的一键连接指纹不变就复用死令牌')
    assert.match(src, /reconnectRequiredMessage\(e, this\.reconnectAttempted/)
  })
  test(`${file}：门禁拒绝时即使只剩一条连接也列出来，能断开`, () => {
    // 门禁拒绝那一块自带连接列表，不再只在「多于一条」时才出现
    assert.match(src, /<LibraryConnectionList\s+v-if="[^"]*(reconnectMessage|reconnectNeeded)[^"]*"/)
  })
}
