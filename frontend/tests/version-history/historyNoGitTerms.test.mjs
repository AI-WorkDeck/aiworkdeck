// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// BUG-56（v0.49.0 真机）：「完整历史」页把 Git 露了出来——标签叫「提交历史」、
// 行徽标「主线」、每行一串 7 位短哈希。版本面板零 Git 术语是产品红线（version-control.md 地雷 #6，
// 「主线」是 trunk 的直译，也算）。跑法：node --test tests/version-history/*.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import zh from '../../src/locales/zh-CN/version.js'
import en from '../../src/locales/en-US/version.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

// #1488: the project-level action explicitly says commit and explains its result.
// Keep implementation terms out of the rest of the history UI.
const COMMIT_COPY = new Set(['exitProgressCommitting', 'exitProgressChecking', 'exitPrompt', 'exitCommit', 'exitSkip', 'exitNewChanges', 'exitCheckFailed', 'pendingFileCount', 'changesAutoRecorded', 'commitHistoryHelp',
  'commitLocalHelp', 'commitCloudHelp', 'committingChanges', 'saveBeforeCommitFailed',
  'cloudSubmitFirst', 'endSession', 'noActiveSession', 'nameSessionTitle', 'finish'])
const ZH_BANNED = /主线|分支|哈希|git|commit/i
const EN_BANNED = /mainline|main line|branch|hash|\bgit\b/i

test('中文只在全局操作与解释中说提交，不泄露底层 Git 术语', () => {
  const leaks = Object.entries(zh).filter(([key, v]) => typeof v === 'string' && (ZH_BANNED.test(v) || (!COMMIT_COPY.has(key) && /提交/.test(v))))
  assert.deepEqual(leaks, [])
})

test('英文 commit 只用于全局操作与解释，其余底层术语保持隐藏', () => {
  const leaks = Object.entries(en).filter(([key, v]) => typeof v === 'string' && (EN_BANNED.test(v) || (!COMMIT_COPY.has(key) && /commit/i.test(v))))
  assert.deepEqual(leaks, [])
})

test('完整历史标签名与版本面板上的入口同名', () => {
  assert.equal(zh.historyTabName, zh.openFullHistory)
})

test('完整历史页不向律师展示短哈希', () => {
  const src = read('../../src/components/version/CommitHistoryTab.vue')
  const template = src.slice(src.indexOf('<template>'), src.indexOf('<script'))
  assert.doesNotMatch(template, /shortId|sha\.slice/)
  // 对比两版时的「A → B」与对比标签页两侧标题也不许退回哈希
  assert.doesNotMatch(src, /slice\(0,\s*7\)/)
})
