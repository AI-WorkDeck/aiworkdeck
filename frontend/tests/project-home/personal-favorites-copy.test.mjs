// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 教程问题 63（dev-board#1713）：设置页「全部收藏」的复制顺序与插件面板统一为
// 正文 → 来源网址 → 标题；只有图片的收藏（截图收藏）复制图片本身。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../../src/components/userprofile/PersonalFavoritesPanel.vue', import.meta.url), 'utf8')

function makeVm(stubs) {
  const script = SRC.slice(SRC.indexOf('<script>') + 8, SRC.indexOf('</script>'))
  const importRe = /import\s*\{([\s\S]*?)\}\s*from\s*'[^']+'\s*;?/g
  const defaultImportRe = /import\s+([A-Za-z_$][\w$]*)\s+from\s*'[^']+'\s*;?/g
  const locals = []
  let m
  while ((m = importRe.exec(script)) !== null) for (const p of m[1].split(',')) if (p.trim()) locals.push(p.trim())
  while ((m = defaultImportRe.exec(script)) !== null) locals.push(m[1])
  const preamble = locals.map((n) => `const ${n} = __stubs[${JSON.stringify(n)}] || (() => {});`).join('\n')
  const body = script.replace(importRe, '').replace(defaultImportRe, '').replace('export default', 'return')
  // eslint-disable-next-line no-new-func
  const component = new Function('__stubs', 'uni', preamble + '\n' + body)(stubs, stubs.uni)
  return Object.assign({ $t: (k) => k }, component.methods)
}

function harness() {
  const copied = []
  const uni = { setClipboardData: ({ data, success }) => { copied.push(['text', data]); success && success() }, showToast() {} }
  const vm = makeVm({ uni, getFavoriteImageUrl: (id) => `https://host/api/favorites/${id}/image` })
  vm.writeImageToClipboard = async (url) => { copied.push(['image', url]) }
  return { vm, copied }
}

test('63: 复制顺序 正文 → 来源网址 → 标题', async () => {
  const { vm, copied } = harness()
  await vm.copyFavorite({ id: 1, content: '正文', sourceUrl: 'https://a.test', title: 'T' })
  await vm.copyFavorite({ id: 2, content: '', sourceUrl: 'https://a.test', title: 'T' })
  await vm.copyFavorite({ id: 3, content: '', title: '只有标题' })
  assert.deepEqual(copied, [['text', '正文'], ['text', 'https://a.test'], ['text', '只有标题']])
})

test('63: 只有图片的收藏复制图片本身，不复制网址', async () => {
  const { vm, copied } = harness()
  await vm.copyFavorite({ id: 9, content: '', imagePath: '/x.png', sourceUrl: 'https://a.test/shot', title: 'a.test 2026-11-04 10:00' })
  assert.deepEqual(copied, [['image', 'https://host/api/favorites/9/image']])
})
