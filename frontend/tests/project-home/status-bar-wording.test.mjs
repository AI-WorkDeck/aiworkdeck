// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D14 / X-S3: the status bar and version prompts speak to lawyers — "save a version", never git's
// "commit"; no terminal font; no "Mobile inbox: not enabled" for a feature the user never turned on.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const dir = new URL('../../src/locales/', import.meta.url)
const KEYS = ['exitCommitUnconfirmed', 'exitProjectsHint', 'exitProjectsCommit', 'exitProjectsCommitted', 'exitProgressChecking',
  'exitProgressCommitting', 'exitPrompt', 'exitCommit', 'exitSkip', 'exitNewChanges', 'exitCheckFailed', 'pendingFileCount',
  'changesAutoRecorded', 'commitHistoryHelp', 'commitLocalHelp', 'commitCloudHelp', 'committingChanges', 'saveBeforeCommitFailed',
  'endSession', 'noActiveSession', 'nameSessionTitle', 'finish']
const GIT_WORDS = /commit|提交|コミット|커밋|коммит|Commit/i

test('no version-history prompt uses git wording, in any locale', () => {
  for (const locale of fs.readdirSync(dir).filter((d) => /^[a-z]{2}-[A-Z]{2}$/.test(d))) {
    const src = fs.readFileSync(new URL(locale + '/version.js', dir), 'utf8').replace(/^\s*export\s+default\s*/m, 'return ')
    const ns = new Function(src)()
    for (const k of KEYS) assert.doesNotMatch(String(ns[k]), GIT_WORDS, `${locale}.version.${k}: ${ns[k]}`)
  }
})

test('the status bar uses the interface font and hides an unused mobile inbox', () => {
  const scss = fs.readFileSync(new URL('../../src/pages/project-overview/project-overview.scss', import.meta.url), 'utf8')
  assert.doesNotMatch(scss, /font-family: var\(--awd-font-mono, 'JetBrains Mono'/)
  const mobile = fs.readFileSync(new URL('../../src/components/MobileReceiveStatus.vue', import.meta.url), 'utf8')
  assert.match(mobile, /<view v-if="!inactive \|\| open" class="mobile-receive">/)
})
