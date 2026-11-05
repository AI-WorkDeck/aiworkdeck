// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 展示名/头像写去哪儿、姓名引导弹不弹（src/utils/identityProfile.js）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PROFILE_SOURCE, resolveProfileSource,
  shouldPromptNameNudge, withNudgeShown, NAME_NUDGE_STORAGE_KEY,
  NAME_NUDGE_REMIND_INTERVAL_MS as DAY3, normalizeNudgeRecords,
} from '../../src/utils/identityProfile.js'

test('local-mode 且已连接账户 → 写官网', () => {
  assert.equal(resolveProfileSource({ localMode: true, connected: true }), PROFILE_SOURCE.ACCOUNT)
})

test('缺任一条件一律回落本机', () => {
  assert.equal(resolveProfileSource({ localMode: true, connected: false }), PROFILE_SOURCE.LOCAL)
  assert.equal(resolveProfileSource({ localMode: false, connected: true }), PROFILE_SOURCE.LOCAL)
  assert.equal(resolveProfileSource({ localMode: false, connected: false }), PROFILE_SOURCE.LOCAL)
  // 状态还没读回来（undefined / 整个参数缺席）也算不成立：宁可显示成自建服务器那套只读形态，
  // 也不要先画出一个会失败的输入框
  assert.equal(resolveProfileSource({}), PROFILE_SOURCE.LOCAL)
  assert.equal(resolveProfileSource(), PROFILE_SOURCE.LOCAL)
})

test('默认名 + 没打发过 → 弹一次', () => {
  assert.equal(shouldPromptNameNudge({ displayNameIsDefault: true, accountId: 'acc_1', dismissedIds: [] }), true)
})

test('刚弹过（稍后）3 天内不再弹，满 3 天再弹一次', () => {
  const rec = withNudgeShown({}, 'acc_1', 1000)
  const q = (now) => shouldPromptNameNudge({ displayNameIsDefault: true, accountId: 'acc_1', records: rec, now })
  assert.equal(q(1000 + DAY3 - 1), false)
  assert.equal(q(1000 + DAY3), true)
  // 换个账户仍然要弹：记录是按 accountId 记的
  assert.equal(shouldPromptNameNudge({ displayNameIsDefault: true, accountId: 'acc_2', records: rec, now: 2000 }), true)
})

test('最多再提醒 2 次：共弹 3 次后不再弹', () => {
  let rec = {}
  let now = 0
  let shows = 0
  for (let i = 0; i < 10; i++) {
    if (shouldPromptNameNudge({ displayNameIsDefault: true, accountId: 'a', records: rec, now })) {
      shows++
      rec = withNudgeShown(rec, 'a', now)
    }
    now += DAY3
  }
  assert.equal(shows, 3)
})

test('点了去填写（done）后不再提醒；填了名字（不再是默认名）也不弹', () => {
  const rec = withNudgeShown(withNudgeShown({}, 'a', 0), 'a', 1, true)
  assert.equal(rec.a.n, 1, 'done 不额外计数')
  assert.equal(shouldPromptNameNudge({ displayNameIsDefault: true, accountId: 'a', records: rec, now: 10 * DAY3 }), false)
  const snoozed = withNudgeShown({}, 'a', 0)
  assert.equal(shouldPromptNameNudge({ displayNameIsDefault: false, accountId: 'a', records: snoozed, now: 10 * DAY3 }), false)
})

test('老版本落的 accountId 数组：算弹过 1 次，到期可再提醒', () => {
  assert.equal(normalizeNudgeRecords(['acc_1']).acc_1.n, 1)
  assert.equal(shouldPromptNameNudge({ displayNameIsDefault: true, accountId: 'acc_1', dismissedIds: ['acc_1'], now: DAY3 }), true)
})

test('名字已经填过、或认不出是哪个账户 → 不弹', () => {
  assert.equal(shouldPromptNameNudge({ displayNameIsDefault: false, accountId: 'acc_1', records: {} }), false)
  assert.equal(shouldPromptNameNudge({ displayNameIsDefault: true, accountId: '', records: {} }), false)
  assert.equal(shouldPromptNameNudge({ displayNameIsDefault: true, records: {} }), false)
  assert.equal(shouldPromptNameNudge(), false)
})

test('storage 里是垃圾数据时按「没弹过」算，不炸', () => {
  assert.equal(shouldPromptNameNudge({ displayNameIsDefault: true, accountId: 'acc_1', records: null }), true)
  assert.equal(shouldPromptNameNudge({ displayNameIsDefault: true, accountId: 'acc_1', records: 'acc_1' }), true)
  assert.deepEqual(Object.keys(withNudgeShown('nonsense', 'acc_1', 5)), ['acc_1'])
})

test('记录有上限 50 个账户', () => {
  let rec = {}
  for (let i = 0; i < 60; i++) rec = withNudgeShown(rec, `acc_${i}`, i)
  assert.equal(Object.keys(rec).length, 50)
  assert.ok(rec.acc_59)
})

test('storage key 是契约的一部分：改了等于把所有人的已读记录清空', () => {
  assert.equal(NAME_NUDGE_STORAGE_KEY, 'awd_name_nudge_dismissed')
})
