// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createApp, h, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import Card from '../../src/components/legal/LegalReferenceCard.vue'
import Pane from '../../src/components/legal/LegalReferencePane.vue'
const modules = import.meta.glob('../../src/locales/*/legalReference.js', { eager: true })
const messages = Object.fromEntries(Object.entries(modules).map(([path, mod]) => [path.split('/').at(-2), { legalReference: mod.default }]))
const i18n = createI18n({ legacy: true, locale: 'zh-CN', messages })
const record = reactive({
  id: 'synthetic-law', kind: 'LAW', title: '合成材料：检索结果展示测试', source: '合成来源 · 仅供界面测试',
  url: 'https://example.org/legal/source', retrievedAt: '2026-10-29T10:20:00+08:00', status: 'retrieved', note: '',
  metadata: [{ labelKey: 'legalReference.documentNumber', value: '合成〔2026〕01号' }, { labelKey: 'legalReference.authority', value: '合成发布机关' }, { labelKey: 'legalReference.effectiveDate', value: '2026-10-29' }],
  sections: [{ labelKey: 'legalReference.article', text: '第一条\n本段为合成测试资料，用于验证资料卡和阅读页的展示。\n\n第二条\n展示来源、版本和资料边界。' }],
})
window.state = record
window.opened = []
window.openedUrls = []
window.setLocale = (locale) => { i18n.global.locale = locale; document.documentElement.lang = locale; document.documentElement.dir = locale === 'ar-SA' ? 'rtl' : 'ltr' }
createApp({ render: () => h('main', { class: 'fixture' }, [
  h('div', { class: 'fixture-card' }, [h(Card, { reference: record, onOpen: value => window.opened.push(value.id) })]),
  h('div', { class: 'fixture-pane' }, [h(Pane, { reference: record, onOpenUrl: url => window.openedUrls.push(url) })]),
]) }).use(i18n).mount('#app')
window.ready = true
