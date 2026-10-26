// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  SYSTEM_LANGUAGE_MODE,
  LOCALE_REGISTRY as FE_REGISTRY,
  SUPPORTED_LOCALE_CODES as FE_CODES,
  COUNTRY_TO_LOCALE as FE_COUNTRY_MAP,
  normalizeLocaleCode,
  normalizeLanguageSetting,
  matchSystemLocale,
  matchCountryToLocale,
  getLocaleEntry,
  getLocaleFallbackChain,
} from '../../src/locales/registry.js'
import {
  LOCALE_REGISTRY as ADDIN_REGISTRY,
  SUPPORTED_LOCALE_CODES as ADDIN_CODES,
  COUNTRY_TO_LOCALE as ADDIN_COUNTRY_MAP,
  matchCountryToLocale as addinMatchCountryToLocale,
} from '../../../office-addin/taskpane/locales/registry.js'
import {
  SUPPORTED_LANGUAGES,
  getAppLanguage,
  getAppLanguagePreference,
  setAppLanguage,
  isChineseUi,
  isEnglish,
  getLocaleMeta,
  tr,
} from '../../src/utils/appLanguage.js'
import {
  buildMessages,
  applyI18nLocale,
  i18n,
  t,
} from '../../src/i18n/index.js'
import { buildMenuPayload } from '../../src/config/commands/index.js'
import {
  setLang as setAddinLang,
  getLang as getAddinLang,
  getLangTag as getAddinLangTag,
  getLangPreference as getAddinLangPref,
  registerLocaleDictionary,
  t as addinT,
} from '../../../office-addin/taskpane/lib/i18n.js'

const require = createRequire(import.meta.url)

// Stub electron for desktop/main/app-language.js
const electronStub = {
  app: {
    getPath: () => '/tmp',
    getLocale: () => 'en-US',
  },
}
const Module = require('node:module')
const origLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub
  return origLoad.call(this, request, parent, isMain)
}
const desktopLang = require('../../../desktop/main/app-language.js')

test('三端语言注册表（frontend / desktop / office-addin）完全一致且包含全部 20 语种', () => {
  assert.equal(FE_REGISTRY.length, 20)
  assert.deepEqual(FE_CODES, [
    'zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR',
    'th-TH', 'ms-MY', 'id-ID', 'vi-VN', 'fr-FR',
    'de-DE', 'es-ES', 'pt-BR', 'it-IT', 'ru-RU',
    'el-GR', 'tr-TR', 'nl-NL', 'hi-IN', 'ar-SA',
  ])
  assert.deepEqual(FE_REGISTRY, ADDIN_REGISTRY)
  assert.deepEqual(FE_REGISTRY, desktopLang.LOCALE_REGISTRY)
  assert.deepEqual(FE_CODES, ADDIN_CODES)
  assert.deepEqual(FE_CODES, desktopLang.SUPPORTED_LOCALE_CODES)

  const ar = getLocaleEntry('ar-SA')
  assert.equal(ar.dir, 'rtl')
  assert.equal(ar.lowaUiLang, 'en-US')
  assert.equal(ar.allowHan, false)

  const zhTw = getLocaleEntry('zh-TW')
  assert.equal(zhTw.dir, 'ltr')
  assert.equal(zhTw.lowaUiLang, 'zh-CN')
  assert.equal(zhTw.allowHan, true)

  const ja = getLocaleEntry('ja-JP')
  assert.equal(ja.allowHan, true)
  assert.equal(ja.lowaUiLang, 'en-US')

  assert.deepEqual(FE_COUNTRY_MAP, ADDIN_COUNTRY_MAP)
  assert.deepEqual(FE_COUNTRY_MAP, desktopLang.COUNTRY_TO_LOCALE)
  assert.equal(matchCountryToLocale('CN'), 'zh-CN')
  assert.equal(matchCountryToLocale('TW'), 'zh-TW')
  assert.equal(matchCountryToLocale('HK'), 'zh-TW')
  assert.equal(matchCountryToLocale('JP'), 'ja-JP')
  assert.equal(matchCountryToLocale('KR'), 'ko-KR')
  assert.equal(matchCountryToLocale('SA'), 'ar-SA')
  assert.equal(matchCountryToLocale('BR'), 'pt-BR')
  assert.equal(addinMatchCountryToLocale('DE'), 'de-DE')
  assert.equal(desktopLang.matchCountryToLocale('FR'), 'fr-FR')
  assert.equal(matchCountryToLocale('XX'), '')
})

test('遗留语言值归一化与系统语言匹配规则（exact -> prefix -> en-US）', () => {
  assert.equal(normalizeLocaleCode('zh'), 'zh-CN')
  assert.equal(normalizeLocaleCode('zh-Hans'), 'zh-CN')
  assert.equal(normalizeLocaleCode('zh_CN'), 'zh-CN')
  assert.equal(normalizeLocaleCode('zh-SG'), 'zh-CN')
  assert.equal(normalizeLocaleCode('zh-TW'), 'zh-TW')
  assert.equal(normalizeLocaleCode('zh-HK'), 'zh-TW')
  assert.equal(normalizeLocaleCode('zh-MO'), 'zh-TW')
  assert.equal(normalizeLocaleCode('zh-Hant'), 'zh-TW')
  assert.equal(normalizeLocaleCode('zh-Hant-HK'), 'zh-TW')
  assert.equal(normalizeLocaleCode('en'), 'en-US')
  assert.equal(normalizeLocaleCode('en-GB'), 'en-US')
  assert.equal(normalizeLocaleCode('pt'), 'pt-BR')
  assert.equal(normalizeLocaleCode('pt-PT'), 'pt-BR')
  assert.equal(normalizeLocaleCode('in-ID'), 'id-ID')
  assert.equal(normalizeLocaleCode('ar-EG'), 'ar-SA')
  assert.equal(normalizeLocaleCode('xx-YY'), '')

  assert.equal(normalizeLanguageSetting('system'), SYSTEM_LANGUAGE_MODE)
  assert.equal(normalizeLanguageSetting('auto'), SYSTEM_LANGUAGE_MODE)
  assert.equal(normalizeLanguageSetting('fr'), 'fr-FR')

  assert.equal(matchSystemLocale('zh-HK'), 'zh-TW')
  assert.equal(matchSystemLocale('pt'), 'pt-BR')
  assert.equal(matchSystemLocale('sv-SE'), 'en-US')
  assert.equal(matchSystemLocale(''), 'en-US')

  assert.deepEqual(getLocaleFallbackChain('zh-CN'), ['zh-CN'])
  assert.deepEqual(getLocaleFallbackChain('zh-TW'), ['zh-TW', 'zh-CN'])
  assert.deepEqual(getLocaleFallbackChain('en-US'), ['en-US', 'zh-CN'])
  assert.deepEqual(getLocaleFallbackChain('de-DE'), ['de-DE', 'en-US', 'zh-CN'])
})

test('appLanguage.js：支持 20 语种 + system、tr() 多语种回退链与 HTML dir/lang 同步', () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  const docEl = { lang: 'zh-CN', dir: 'ltr' }
  globalThis.document = { documentElement: docEl }

  assert.equal(SUPPORTED_LANGUAGES.length, 21)
  assert.ok(SUPPORTED_LANGUAGES.includes('system'))

  setAppLanguage('zh-TW')
  assert.equal(getAppLanguage(), 'zh-TW')
  assert.equal(getAppLanguagePreference(), 'zh-TW')
  assert.equal(isChineseUi(), true)
  assert.equal(isEnglish(), false)
  assert.equal(docEl.lang, 'zh-TW')
  assert.equal(docEl.dir, 'ltr')
  // zh-TW 缺失时回退到 zh-CN/zh，而不是 en
  assert.equal(tr({ zh: '简体文案', en: 'English copy' }), '简体文案')
  assert.equal(tr({ 'zh-TW': '繁體文案', zh: '简体文案', en: 'English copy' }), '繁體文案')

  setAppLanguage('ar-SA')
  assert.equal(getAppLanguage(), 'ar-SA')
  assert.equal(isChineseUi(), false)
  assert.equal(isEnglish(), true)
  assert.equal(getLocaleMeta().lowaUiLang, 'en-US')
  assert.equal(docEl.lang, 'ar-SA')
  assert.equal(docEl.dir, 'rtl')
  // 非中文缺失时优先回退 en-US/en，再回退 zh-CN/zh
  assert.equal(tr({ zh: '简体文案', en: 'English copy' }), 'English copy')
  assert.equal(tr({ zh: '仅中文' }), '仅中文')
  assert.equal(tr({ 'ar-SA': 'نص عربي', en: 'English copy', zh: '简体文案' }), 'نص عربي')

  setAppLanguage('system')
  assert.equal(getAppLanguagePreference(), 'system')
  assert.ok(FE_CODES.includes(getAppLanguage()))
})

test('vue-i18n buildMessages + applyI18nLocale 热切换与回退链', () => {
  const docEl = { lang: 'zh-CN', dir: 'ltr' }
  globalThis.document = { documentElement: docEl }

  const msgs = buildMessages({
    '../locales/zh-CN/common.js': { default: { hello: '你好', onlyZh: '仅中文' } },
    '../locales/en-US/common.js': { default: { hello: 'Hello' } },
    '../locales/fr-FR/common.js': { default: { hello: 'Bonjour' } },
  })
  assert.equal(msgs['zh-CN'].common.hello, '你好')
  assert.equal(msgs['en-US'].common.hello, 'Hello')
  assert.equal(msgs['fr-FR'].common.hello, 'Bonjour')
  assert.deepEqual(msgs['de-DE'], {})

  i18n.global.setLocaleMessage('zh-CN', msgs['zh-CN'])
  i18n.global.setLocaleMessage('en-US', msgs['en-US'])
  i18n.global.setLocaleMessage('fr-FR', msgs['fr-FR'])
  i18n.global.setLocaleMessage('zh-TW', {})
  i18n.global.setLocaleMessage('ar-SA', {})

  applyI18nLocale('fr-FR')
  assert.equal(t('common.hello'), 'Bonjour')
  assert.equal(t('common.onlyZh'), '仅中文')

  applyI18nLocale('zh-TW')
  assert.equal(t('common.hello'), '你好')

  applyI18nLocale('ar-SA')
  assert.equal(t('common.hello'), 'Hello')
  assert.equal(docEl.lang, 'ar-SA')
  assert.equal(docEl.dir, 'rtl')
})

test('桌面应用菜单 buildMenuPayload 生成 Language 子菜单（跟随系统 + 20 语种）', () => {
  const payload = buildMenuPayload({ page: 'workbench', langPref: 'ja-JP', flags: {} }, 'ja-JP')
  const appMenu = payload.menus.find((m) => m.id === 'app')
  const langItem = appMenu.items.find((i) => i.id === 'app.language')
  assert.ok(langItem, '缺少 app.language 子菜单')
  assert.equal(langItem.label, 'Language')
  assert.equal(langItem.submenu.length, 21)
  assert.equal(langItem.submenu[0].id, 'app.lang.system')
  assert.equal(langItem.submenu[0].checked, false)
  const jaItem = langItem.submenu.find((i) => i.id === 'app.lang.ja-JP')
  assert.ok(jaItem)
  assert.equal(jaItem.checked, true)
})

test('Office Add-in i18n 支持 20 语种、system 模式与多级字典回退', () => {
  registerLocaleDictionary('fr-FR', { send: 'Envoyer' })
  setAddinLang('fr-FR')
  assert.equal(getAddinLangTag(), 'fr-FR')
  assert.equal(getAddinLangPref(), 'fr-FR')
  assert.equal(getAddinLang(), 'en')
  assert.equal(addinT('send'), 'Envoyer')
  // fr-FR 未翻译的键回退到 EN
  assert.equal(addinT('cancel'), 'Cancel')

  setAddinLang('zh-TW')
  assert.equal(getAddinLangTag(), 'zh-TW')
  assert.equal(getAddinLang(), 'zh')
  // zh-TW 未翻译的键回退到 ZH
  assert.equal(addinT('cancel'), '取消')

  setAddinLang('system')
  assert.equal(getAddinLangPref(), 'system')
})
