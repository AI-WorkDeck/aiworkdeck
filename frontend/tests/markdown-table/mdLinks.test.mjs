// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// S26：Markdown 正文里的链接不能在应用页里打开。渲染器给每个链接加 target/rel，
// 点击由 MarkdownPreview / PlainTextEditor 的事件委托交给 handleRenderedLinkClick。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import MarkdownIt from 'markdown-it'
import { renderMarkdown, withExternalLinkAttrs } from '../../src/utils/markdownRenderer.js'

test('explicit, autolinked and relative links all carry target/rel', () => {
  const html = renderMarkdown('[a](https://example.com/x) see https://example.org and [r](notes.md) [h](#top)')
  const anchors = html.match(/<a [^>]*>/g)
  assert.equal(anchors.length, 4)
  for (const a of anchors) {
    assert.match(a, /target="_blank"/)
    assert.match(a, /rel="noopener noreferrer"/)
  }
  assert.match(html, /href="https:\/\/example\.com\/x"/)
})

test('raw HTML stays escaped and dangerous schemes are still dropped', () => {
  const html = renderMarkdown('<a href="https://e.com">x</a> [j](javascript:alert(1))')
  assert.doesNotMatch(html, /<a href="https:\/\/e\.com">/)
  assert.doesNotMatch(html, /href="javascript:/)
})

test('the plain-text editor preview instance uses the same rule', () => {
  const md = withExternalLinkAttrs(new MarkdownIt({ html: false, linkify: true }))
  assert.match(md.render('[a](https://example.com)'), /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">/)
})

test('both rendered-markdown containers delegate link clicks', () => {
  const preview = readFileSync(new URL('../../src/components/MarkdownPreview.vue', import.meta.url), 'utf8')
  assert.match(preview, /handleBodyClick\(event\) \{\s*if \(handleRenderedLinkClick\(event\)\) return/)
  // uni 的 <view> 上的 @click 拿不到原生事件（preventDefault 不生效），委托容器必须是原生元素
  assert.match(preview, /<div v-else class="markdown-body" @click="handleBodyClick">/)
  const editor = readFileSync(new URL('../../src/components/PlainTextEditor.vue', import.meta.url), 'utf8')
  assert.match(editor, /<div class="markdown-body" v-html="previewHtml" @click="onPreviewClick"><\/div>/)
  assert.match(editor, /withExternalLinkAttrs\(new MarkdownIt/)
})
