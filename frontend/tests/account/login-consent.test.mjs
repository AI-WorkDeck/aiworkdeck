// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 登录弹层的同意项与分段控件（问题 1、36、2+38）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import zhOnboarding from '../../src/locales/zh-CN/onboarding.js'
import enOnboarding from '../../src/locales/en-US/onboarding.js'

const source = readFileSync(new URL('../../src/components/account/AccountLoginDialog.vue', import.meta.url), 'utf8')

function extractMethod(name, nextName) {
  const start = source.indexOf(`    ${name}(`)
  assert.ok(start > 0, `${name} 存在`)
  const end = source.indexOf(`\n    ${nextName}(`, start)
  return source.slice(start, end)
}

function gateVm({ agreementChecked, crossBorderChecked, isPhoneSite = true }) {
  const methods = new Function(`return ({${extractMethod('consentGatePassed', 'openLegalDoc')}})`)()
  const vm = { agreementChecked, crossBorderChecked, isPhoneSite, errorMsg: '', $t: (k) => k }
  if (source.includes('    crossBorderKey(')) {
    Object.assign(vm, new Function(`return ({${extractMethod('crossBorderKey', 'consentGatePassed')}})`)())
  }
  return { vm, pass: () => methods.consentGatePassed.call(vm) }
}

test('问题 1：两项都没勾时一次提示两项，不用被拦两次', () => {
  const { vm, pass } = gateVm({ agreementChecked: false, crossBorderChecked: false })
  assert.equal(pass(), false)
  assert.equal(vm.errorMsg, 'onboarding.unlock.consentBothRequired')
})

test('问题 1：只缺一项时提示那一项；都勾了放行', () => {
  let g = gateVm({ agreementChecked: false, crossBorderChecked: true })
  assert.equal(g.pass(), false)
  assert.equal(g.vm.errorMsg, 'onboarding.unlock.agreementRequired')
  g = gateVm({ agreementChecked: true, crossBorderChecked: false, isPhoneSite: false })
  assert.equal(g.pass(), false)
  assert.equal(g.vm.errorMsg, 'onboarding.unlock.crossBorderRequired')
  g = gateVm({ agreementChecked: true, crossBorderChecked: true })
  assert.equal(g.pass(), true)
})

test('问题 2+38：国内站勾选框、告知、提示统一用「可能涉及境外处理」口径；国际站不变', () => {
  const g = gateVm({ agreementChecked: true, crossBorderChecked: false, isPhoneSite: true })
  assert.equal(g.pass(), false)
  assert.equal(g.vm.errorMsg, 'onboarding.unlock.crossBorderRequiredDomestic')
  assert.match(source, /\$t\(crossBorderKey\('crossBorderLabel'\)\)/)
  assert.match(source, /\$t\(this\.crossBorderKey\('crossBorderNoticeTitle'\)\)/)
  assert.match(source, /\$t\(this\.crossBorderKey\('crossBorderNoticeBody'\)\)/)
  const zh = zhOnboarding.unlock
  for (const key of ['crossBorderLabelDomestic', 'crossBorderNoticeTitleDomestic', 'crossBorderNoticeBodyDomestic', 'crossBorderRequiredDomestic']) {
    assert.ok(zh[key], key)
    assert.doesNotMatch(zh[key], /跨境传输至境外模型服务商|OpenRouter/)
  }
  assert.match(zh.crossBorderLabelDomestic, /可能涉及境外处理/)
  assert.match(zh.crossBorderNoticeBodyDomestic, /可能涉及境外处理/)
  // 国际站措辞不变
  assert.equal(zh.crossBorderLabel, '单独同意：将送入 AI 的内容跨境传输至境外模型服务商处理')
  assert.equal(enOnboarding.unlock.crossBorderLabel, 'Separate consent: transfer content submitted to AI to overseas model providers for processing')
})

test('问题 36：分段控件选中项叫「账号登录」，表单下方不再重复放扫码链接', () => {
  const seg = source.slice(source.indexOf('顶部分段切换'), source.indexOf('<div v-show="mode === \'login\'"'))
  assert.match(seg, /\$t\('account\.accountLoginTab'\)/)
  assert.doesNotMatch(seg, /bqtScanBack/)
  const loginBlock = source.slice(source.indexOf('<div v-show="mode === \'login\'"'), source.indexOf('<div v-if="mode === \'bqt\'"'))
  assert.doesNotMatch(loginBlock, /bqtScanSwitch/)
})

test('问题 g13：弹层形态勾选框在登录按钮之前，未勾选提示夹在两者之间；站点切换在底部', () => {
  const tpl = source.slice(0, source.indexOf('<script>'))
  const consentAt = tpl.indexOf('<div class="unlock-consent">')
  const dialogError = tpl.indexOf('<div v-if="errorMsg && variant === \'dialog\'" class="unlock-error">')
  const dialogBtn = tpl.indexOf('v-if="mode !== \'bqt\' && variant === \'dialog\'"')
  assert.ok(consentAt > 0 && dialogError > consentAt && dialogBtn > dialogError, '弹层：勾选框 → 提示 → 登录按钮')
  // 页面形态保持原顺序：提示 → 按钮 → 勾选框
  const pageBtn = tpl.indexOf('v-if="mode !== \'bqt\' && variant !== \'dialog\'"')
  assert.ok(pageBtn > 0 && pageBtn < consentAt, '页面形态的按钮仍在勾选框之前')

  // 站点：顶部药丸只给页面形态，弹层形态的下拉在底部那一行里、语言选择器旁边
  assert.match(tpl, /v-if="siteStatus\.multiSite && variant !== 'dialog'"\s+class="unlock-site-seg"/)
  const foot = tpl.indexOf('<div class="unlock-card-foot">')
  const siteSelect = tpl.indexOf('class="unlock-site-select"')
  assert.ok(foot > 0 && siteSelect > foot, '站点下拉位于底部')
  assert.ok(siteSelect > tpl.indexOf('<LanguagePicker'), '站点下拉在语言选择器之后')
  assert.ok(siteSelect < tpl.indexOf('<div class="unlock-foot-right">'), '站点下拉与语言选择器同在左侧')
  assert.match(tpl.slice(siteSelect, tpl.indexOf('</component>', siteSelect)), /onSiteSegTap\(/, '沿用原切站入口')

  // 登录方式：弹层形态用下划线标签
  assert.match(tpl, /variant === 'dialog' \? 'unlock-mode-tabs' : 'unlock-site-seg'/)
  assert.equal(zhOnboarding.unlock.consentBothRequired, '请先勾选上方两项同意')
})
