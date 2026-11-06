// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 教程第 11 集：「此服务器未开通统一账户充值」只闪一下 toast，弹窗没有任何变化，律师以为没点上。
// 放进案件库 / 重新绑定失败（又不是要重新连接）时，原因必须留在弹窗里，并给出下一步。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../../src/components/collab/CollabDialog.vue', import.meta.url), 'utf8')

test('放进案件库失败的原因留在弹窗里，不再只闪 toast', () => {
  assert.doesNotMatch(src, /showToast\(\{ title: \(e && e\.message\) \|\| this\.\$t\('version\.shareToLibraryFailed'\)/)
  assert.equal(src.match(/this\.shareError = \(e && e\.message\) \|\| this\.\$t\('version\.shareToLibraryFailed'\)/g).length, 2)
  assert.match(src, /v-if="shareError && !reconnectMessage"/)
  assert.match(src, /\$t\('version\.cloudServiceIssueHint'\)/)
})

test('重新点「放进团队案件库」或「重新绑定」时先清掉上一次的错误', () => {
  const share = src.slice(src.indexOf('async onShare()'), src.indexOf('async onReconnectCloud()'))
  assert.match(share, /this\.shareError = ''/)
  const rebind = src.slice(src.indexOf('async onRebindCaseFile()'))
  assert.match(rebind.slice(0, 200), /this\.shareError = ''/)
})
