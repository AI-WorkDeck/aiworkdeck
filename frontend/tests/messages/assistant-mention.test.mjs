// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mentionsAssistant } from '../../src/utils/assistantMention.js'

test('C14: explicit @ mentions of the assistant', () => {
  for (const t of ['@助手 帮我总结', '请 @AI 看看', '@项目助手 第五条？', '＠助手 全角也算', '@assistant summarise']) assert.equal(mentionsAssistant(t, { name: '项目助手' }), true, t)
  for (const t of ['助手你好', 'email me@company.com', '@陆知微 你看下', '', null]) assert.equal(mentionsAssistant(t, { name: '项目助手' }), false, String(t))
  assert.equal(mentionsAssistant('@星禾顾问 帮忙', { name: '星禾顾问' }), true, 'custom assistant name')
})
