// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 脱敏面板保留可选补充词；中文姓名默认自动识别（dev-board#599）。
//
// 渲染这一层照 tests/evidence/previewLocateRender.test.mjs 的做法：用 vue 自带的
// compiler-sfc 真编译 <template>、真渲染成 HTML。只读源码的断言发现不了「键打错了」
// 「挂在 v-if 的另一支里」这类问题。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileTemplate } from 'vue/compiler-sfc'
import * as VueRuntime from 'vue'
import * as SsrRuntime from 'vue/server-renderer'
import { renderToString } from 'vue/server-renderer'

const SRC = readFileSync(new URL('../../src/components/DesensitizePane.vue', import.meta.url), 'utf8')

function buildSsrRender() {
  const { descriptor, errors } = parse(SRC, { filename: 'DesensitizePane.vue' })
  assert.equal(errors.length, 0, 'DesensitizePane.vue 解析失败')
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: 'DesensitizePane.vue',
    id: 'desensitize-pane',
    ssr: true,
    ssrCssVars: [],
  })
  assert.equal(compiled.errors.length, 0, '模板编译报错：' + compiled.errors.join('; '))
  const body = compiled.code
    .replace(/^import \{([\s\S]*?)\} from "vue"$/m, 'const {$1} = __vue')
    .replace(/^import \{([\s\S]*?)\} from "vue\/server-renderer"$/m, 'const {$1} = __ssr')
    .replace(/\bas\b/g, ':')
    .replace(/^export function ssrRender/m, 'function ssrRender')
  // eslint-disable-next-line no-new-func
  return new Function('__vue', '__ssr', body + '\nreturn ssrRender')(VueRuntime, SsrRuntime)
}

const ssrRender = buildSsrRender()

const componentScript = SRC.slice(SRC.indexOf('<script>') + 8, SRC.indexOf('</script>'))
  .replace(/^import .*$/m, '').replace('export default', 'return')
const component = new Function(componentScript)()
const termsOf = text => component.methods.payload.call({ customTerms: text, excludedTerms: '' }).customTerms

// $t 直接回键名：断言键名即断言「模板引用的 i18n 键」，打错字就对不上。
async function render(state = {}) {
  const app = VueRuntime.createSSRApp({
    ssrRender,
    data: () => ({
      ...component.data(),
      filePath: '',
      fileName: '',
      fileId: null,
      availableStrategies: [
        { value: 'PHONE', label: '手机号 (138****1234)' },
        { value: 'ID_CARD', label: '身份证号 (3301**********1234)' },
      ],
      selectedStrategies: ['PHONE', 'ID_CARD'],
      processing: false,
      customWordsText: '',
      ...state,
    }),
    computed: component.computed,
    methods: {
      ...component.methods,
      $t: (k, p) => (p ? k + JSON.stringify(p) : k),
    },
  })
  // 根节点是 uni 的 <scroll-view>，模板编译成 resolveComponent + ssrRenderComponent；
  // 不注册的话整棵树渲染成空串（用例会以「什么都没有」的方式假红）。桩成「原样渲染插槽」。
  app.component('scroll-view', {
    setup(_props, { slots }) {
      return () => VueRuntime.h('div', { class: 'scroll-view' }, slots.default ? slots.default() : [])
    },
  })
  app.config.warnHandler = () => {}
  const realWarn = console.warn
  console.warn = () => {}
  try {
    return (await renderToString(app)).replace(/&quot;/g, '"')
  } finally {
    console.warn = realWarn
  }
}

const cutBetween = (str, open, close) => {
  let out = str, i = out.indexOf(open)
  while (i !== -1) {
    const j = out.indexOf(close, i + open.length)
    out = j === -1 ? out.slice(0, i) : out.slice(0, i) + out.slice(j + close.length)
    i = out.indexOf(open)
  }
  return out
}
const stripComments = (html) => cutBetween(html, '<!--', '-->')

// ==================== 可选补充词渐进展开 ====================

test('补充词入口默认可见，输入区默认折叠且保留在 DOM 中', async () => {
  const html = stripComments(await render())
  assert.match(html, /panels\.deCustomWordsTitle/, '默认应可找到补充词入口')
  assert.match(html, /<view(?=[^>]*class="custom-words-content")(?=[^>]*style="display:none)[^>]*>/)
  assert.match(html, /class="[^"]*custom-words-input[^"]*"/, '首屏没有自定义词输入框')
  assert.match(html, /panels\.deCustomPlaceholder/, '输入框没有占位提示')
})

test('展开补充词后可查看原有说明', async () => {
  const html = stripComments(await render({ customWordsOpen: true }))
  assert.doesNotMatch(html, /<view(?=[^>]*class="custom-words-content")(?=[^>]*style="display:none)[^>]*>/)
  assert.match(html, /panels\.deCustomWordsHint/, '首屏没有说明文案')
})

test('补充词入口仍在「脱敏策略」勾选区之前', async () => {
  const html = stripComments(await render())
  const words = html.indexOf('panels.deCustomWordsTitle')
  const strategies = html.indexOf('panels.deStrategiesTitle')
  assert.ok(words > -1 && strategies > -1, '两个分区都得在')
  assert.ok(words < strategies, `自定义词区排在策略区后面了（${words} > ${strategies}）`)
})

// ==================== 解析规则 ====================

test('逐行词语保留英文公司名中的空格，不拆分合法短语', () => {
  assert.deepEqual(termsOf('张三\n Acme Technology Co., Ltd. \n'), ['张三', 'Acme Technology Co., Ltd.'])
  assert.deepEqual(termsOf('   '), [])
})

test('自定义词通过预览和生成共用的 payload 传给后端', () => {
  assert.deepEqual(termsOf('张三\n李四'), ['张三', '李四'])
  assert.match(SRC, /previewSensitiveFile\(this\.payload\(\)\)/)
  assert.match(SRC, /desensitizeFile\(\{ \.\.\.this\.payload\(\)/)
})

test('仅填词语时可以先预览；没有输入或未选文件时不能预览', () => {
  assert.match(SRC, /<button[^>]*:disabled="previewDisabled"[^>]*@tap="handlePreview"/)
  const disabled = s => component.computed.previewDisabled.call(s)
  assert.equal(disabled({ processing: false, fileId: 1, selectedStrategies: [], customTerms: '张三' }), false)
  assert.equal(disabled({ processing: false, fileId: 1, selectedStrategies: [], customTerms: '' }), true)
  assert.equal(disabled({ processing: false, fileId: null, selectedStrategies: [], customTerms: '张三' }), true)
})

// ==================== 文案 ====================

const loadPanels = async (lang) =>
  (await import(new URL(`../../src/locales/${lang}/panels.js`, import.meta.url))).default

test('新增文案键在 zh-CN / en-US 两侧都有', async () => {
  const [zh, en] = await Promise.all([loadPanels('zh-CN'), loadPanels('en-US')])
  for (const key of ['deCustomWordsTitle', 'deCustomWordsPlaceholder', 'deCustomWordsHint']) {
    assert.ok(zh[key], `zh-CN 缺 panels.${key}`)
    assert.ok(en[key], `en-US 缺 panels.${key}`)
  }
})

test('说明姓名默认本地识别，补充词是可选入口', async () => {
  const zh = await loadPanels('zh-CN')
  const en = await loadPanels('en-US')
  assert.match(zh.deCustomWordsHint, /默认开启中文姓名识别/)
  assert.match(zh.deCustomWordsTitle, /可选/)
  assert.match(en.deCustomWordsHint, /detected locally by default/)
  assert.match(en.deCustomWordsTitle, /Optional/)
})

test('新增文案不含 emoji（全站红线）', async () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
  for (const lang of ['zh-CN', 'en-US']) {
    const panels = await loadPanels(lang)
    for (const key of ['deCustomWordsTitle', 'deCustomWordsPlaceholder', 'deCustomWordsHint']) {
      assert.ok(panels[key], `${lang} 缺 panels.${key}（键缺席时这条用例会空过，先挡住）`)
      assert.ok(!emoji.test(String(panels[key])), `${lang} panels.${key} 含 emoji`)
    }
  }
})

test('获取策略后默认勾选中文姓名，用户不填补充词也能使用', async () => {
  const fetchScript = componentScript.replace('await getSensitiveOptions()', "[{value:'CHINESE_NAME'}, {value:'PHONE'}]")
  const subject = new Function(fetchScript)()
  const state = { ...subject.data(), $t: key => key }
  await subject.methods.fetchOptions.call(state)
  assert.ok(state.selectedStrategies.includes('CHINESE_NAME'))
  assert.equal(state.customTerms, '')
})


test('地址默认勾选并通过预览和生成共用请求传给后端', async () => {
  const fetchScript = componentScript.replace('await getSensitiveOptions()', "[{value:'ADDRESS'}, {value:'PHONE'}]")
  const subject = new Function(fetchScript)()
  const state = { ...subject.data(), $t: key => key }
  await subject.methods.fetchOptions.call(state)
  assert.ok(state.selectedStrategies.includes('ADDRESS'))
  assert.ok(subject.methods.payload.call(state).strategies.includes('ADDRESS'))
})


test('两种替换方式均说明地址只保留层级，编号须完整保留用于复敏', async () => {
  for (const [lang, expected] of [
    ['zh-CN', /XX省XX市XX区XXXX/],
    ['en-US', /XX Province, XX City, XX District, XXXX/],
  ]) {
    const panels = await loadPanels(lang)
    assert.match(panels.deTokenNotice, expected)
    assert.match(panels.deMaskNotice, expected)
  }
})

// ==================== 键盘语义（dev-board#1713 #97） ====================

test('每个可点控件都有按钮/勾选语义、可聚焦并接 Enter/Space', () => {
  const template = SRC.slice(SRC.indexOf('<template>'), SRC.lastIndexOf('</template>'))
  // 属性里有 `() =>`，不能按 `>` 截标签；模板属性里没有 `<`，按 `<` 切段即可。
  const tags = template.split('<').filter(part => /^(button|view|label)\b/.test(part) && part.includes('@tap='))
  assert.ok(tags.length >= 16, `可点控件数量不对：${tags.length}`)
  for (const tag of tags) {
    assert.match(tag, /role="(button|checkbox)"/, '缺 role：' + tag)
    assert.match(tag, /:tabindex="/, '缺 tabindex：' + tag)
    assert.match(tag, /@keydown="onActionKey\(/, '缺键盘处理：' + tag)
  }
})

test('onActionKey 只响应 Enter/Space，禁用与长按连发不触发', () => {
  const calls = []
  const key = (k, extra = {}) => ({ key: k, repeat: false, preventDefault() { this.prevented = true }, ...extra })
  const run = (event, disabled) => component.methods.onActionKey.call({}, event, () => calls.push(event.key), disabled)
  const enter = key('Enter'); run(enter, false)
  const space = key(' '); run(space, false)
  run(key('a'), false)
  const blocked = key('Enter'); run(blocked, true)
  run(key(' ', { repeat: true }), false)
  assert.deepEqual(calls, ['Enter', ' '])
  assert.ok(enter.prevented && space.prevented && blocked.prevented, 'Space 不拦会滚动面板')
})

test('禁用的按钮移出 Tab 顺序并标 aria-disabled', async () => {
  const html = stripComments(await render({ fileId: null }))
  assert.match(html, /<button(?=[^>]*aria-disabled="true")(?=[^>]*tabindex="-1")[^>]*>panels\.dePreview<\/button>/)
  const ready = stripComments(await render({ fileId: 1 }))
  assert.match(ready, /<button(?![^>]*aria-disabled)(?=[^>]*tabindex="0")[^>]*>panels\.dePreview<\/button>/)
})

// ==================== 疑似号码「仍然遮蔽」（dev-board#1713 #96） ====================

const SUSPECT = '91310115MA1K4YH666'

test('预览逐条列出疑似号码原值与类型，并给「仍然遮蔽」', async () => {
  const html = stripComments(await render({
    fileId: 1,
    availableStrategies: [{ value: 'UNIFIED_SOCIAL_CREDIT', label: '统一社会信用代码 (9111...)' }],
    preview: { text: 'x', counts: {}, suspects: { UNIFIED_SOCIAL_CREDIT: 1 }, suspectItems: [{ type: 'UNIFIED_SOCIAL_CREDIT', value: SUSPECT }] },
  }))
  assert.match(html, /panels\.deSuspectCount/)
  assert.match(html, new RegExp('class="suspect-value"[^>]*>' + SUSPECT))
  assert.match(html, /class="suspect-type"[^>]*>统一社会信用代码</)
  assert.match(html, /<button[^>]*aria-label="panels\.deMaskAnywayLabel\{"value":"91310115MA1K4YH666"\}"[^>]*>panels\.deMaskAnyway<\/button>/)
  // 生成之后不再给按钮（那时改词表也改不了已生成的副本）
  const after = stripComments(await render({ fileId: 1, result: { suspects: { UNIFIED_SOCIAL_CREDIT: 1 } }, preview: null }))
  assert.doesNotMatch(after, /panels\.deMaskAnyway/)
})

test('「仍然遮蔽」写进补充敏感词（不重复）并重新预览', async () => {
  let previews = 0
  const state = {
    processing: false, customTerms: '张三', customWordsOpen: false,
    $nextTick: async () => {}, handlePreview: async () => { previews++ },
  }
  await component.methods.maskSuspect.call(state, SUSPECT)
  assert.equal(state.customTerms, '张三\n' + SUSPECT)
  assert.equal(state.customWordsOpen, true)
  assert.equal(previews, 1)
  await component.methods.maskSuspect.call(state, SUSPECT)
  assert.equal(state.customTerms, '张三\n' + SUSPECT, '同一个号不应重复写入')
  state.processing = true
  await component.methods.maskSuspect.call(state, 'X')
  assert.equal(previews, 2, '处理中不响应')
})

test('「仍然遮蔽」文案 20 语种齐全', async () => {
  const { SUPPORTED_LOCALE_CODES } = await import(new URL('../../src/locales/registry.js', import.meta.url))
  for (const lang of SUPPORTED_LOCALE_CODES) {
    const panels = await loadPanels(lang)
    assert.ok(panels.deMaskAnyway, `${lang} 缺 panels.deMaskAnyway`)
    assert.match(panels.deMaskAnywayLabel || '', /\{value\}/, `${lang} panels.deMaskAnywayLabel 缺 {value}`)
  }
})
