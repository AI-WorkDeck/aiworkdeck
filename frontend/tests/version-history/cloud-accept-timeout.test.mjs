// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C32：「取到本机」一份大案卷（240 MB 版本对象、慢网）要几分钟。请求若沿用 uni.request 默认的 60 秒，
// 界面就报「等待太久…文件较大时可以拆成几份」，而后端照常克隆完、项目却不出现在「最近」里。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withTransferProgress } from '../../src/utils/transferProgress.js'

const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')

function loadAccept() {
  const m = api.match(/export function acceptCloudProject\([^)]*\) \{[\s\S]*?\n\}/)
  assert.ok(m, 'acceptCloudProject is defined in api.js')
  const src = m[0].replace(/^export /, '')
  const calls = []
  const request = (opts) => { calls.push(opts); return Promise.resolve({ data: { localProjectId: 1 } }) }
  const t = (k) => k
  // eslint-disable-next-line no-new-func
  const accept = new Function('request', 'withTransferProgress', 't', `${src}; return acceptCloudProject`)(request, withTransferProgress, t)
  return { accept, calls }
}

test('取到本机 waits long enough for a large clone on a slow link', async () => {
  const { accept, calls } = loadAccept()
  await accept(3, 42, '/Users/lawyer/案卷/星禾诉远帆')
  assert.equal(calls.length, 1)
  const opts = calls[0]
  assert.equal(opts.url, '/api/cloud/accept')
  assert.deepEqual(opts.data, { connectionId: 3, remoteProjectId: 42, localRoot: '/Users/lawyer/案卷/星禾诉远帆' })
  assert.ok(Number(opts.timeout) >= 30 * 60 * 1000,
    `the clone request must not give up at the 60 s default (timeout=${opts.timeout})`)
})

test('without a chosen folder the request body is unchanged', async () => {
  const { accept, calls } = loadAccept()
  await accept(3, 42)
  assert.deepEqual(calls[0].data, { connectionId: 3, remoteProjectId: 42 })
})
