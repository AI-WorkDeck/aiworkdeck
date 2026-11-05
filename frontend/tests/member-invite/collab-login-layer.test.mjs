// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 「放进团队案件库」点了没反应（问题 126/127，dev-board#1713）的源码契约。
//
// 1. 登录层 .awd-login-mask 的 z-index 是 9990，协作弹窗 / 加人弹窗的遮罩是 9999：
//    requireAccount 弹出的登录层被盖在下面，点不到，promise 永远不回。修法是登录层开着时
//    这两个弹窗先收起（visibility: hidden），登录完自己回来，而不是动全局 z-index。
// 2. 后端以 kind=CLOUD_RECONNECT_REQUIRED 拒绝时，弹窗里要就地写明原因并给「重新连接云端」
//    按钮，调明确重连的 reconnectOfficialCloud（真的换新令牌）；不做自动重连。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')

const req = read('src/utils/requireAccount.js')
const login = read('src/components/account/AccountLoginDialog.vue')

test('requireAccount 公开登录层开合状态：挂载时置真、收尾时置假', () => {
  assert.match(req, /export const accountLoginOpen = ref\(false\)/)
  const open = req.slice(req.indexOf('function openDialog'), req.indexOf('const gate = createAccountGate'))
  assert.match(open, /accountLoginOpen\.value = true/)
  const finish = open.slice(open.indexOf('const finish'), open.indexOf('resolve(result)'))
  assert.match(finish, /accountLoginOpen\.value = false/)
})

test('登录层仍低于 9999 的业务弹窗（所以那两个弹窗必须自己让开）', () => {
  const z = Number((login.match(/\.awd-login-mask \{[^}]*z-index: (\d+)/) || [])[1])
  assert.ok(z > 0 && z < 9999, `登录层 z-index=${z}`)
})

for (const [file, rootClass] of [
  ['src/components/collab/CollabDialog.vue', 'awd-mask collab-mask'],
  ['src/components/InviteMemberDialog.vue', 'workdeck-dialog-mask'],
]) {
  const src = read(file)
  test(`${file}：登录层开着时整块收起，不挡住登录层`, () => {
    assert.match(src, /import \{[^}]*accountLoginOpen[^}]*\} from '@\/utils\/requireAccount\.js'/)
    const tag = src.slice(src.indexOf(`class="${rootClass}"`) - 40, src.indexOf('>', src.indexOf(`class="${rootClass}"`)))
    assert.match(tag, /:class="\{ 'yield-to-login': loginLayerOpen \}"/)
    assert.match(src, /loginLayerOpen\(\) \{\s*return accountLoginOpen\.value\s*\}/)
    assert.match(src, /\.yield-to-login \{\s*visibility: hidden;/)
  })
  test(`${file}：权限门禁拒绝时显示原因与「重新连接云端」按钮，调 reconnectOfficialCloud（明确换新令牌）`, () => {
    assert.match(src, /needsCloudReconnect\(e\)/)
    assert.match(src, /\$t\('version\.reconnectCloud'\)/)
    assert.match(src, /@tap="onReconnectCloud"/)
    const body = src.slice(src.indexOf('async onReconnectCloud()'))
    assert.match(body.slice(0, 800), /await reconnectOfficialCloud\(\)/)
  })
}
