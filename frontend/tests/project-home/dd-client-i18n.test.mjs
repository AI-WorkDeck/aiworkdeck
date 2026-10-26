// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import { renderToString } from '@vue/server-renderer'
import { createI18n } from 'vue-i18n'
import zh from '../../src/locales/zh-CN/ddWorkflow.js'
import en from '../../src/locales/en-US/ddWorkflow.js'

const messages = { 'zh-CN': { ddWorkflow: zh }, 'en-US': { ddWorkflow: en } }
const source = file => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8')
const files = ['components/dd/DdClientWorkspace.vue', 'components/dd/DdClientChecklist.vue', 'pages/client-portal/client-portal.vue']
function component(file) {
  const s = source(file)
  const body = s.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
  const options = new Function('DdClientWorkspace', 'DdClientChecklist', 'ddNotificationPermission', body)({ render: () => null }, { render: () => null }, () => 'unavailable')
  const code = compile(s.match(/<template>([\s\S]*?)<\/template>/)[1], { mode: 'function', isCustomElement: tag => ['view', 'checkbox-group', 'checkbox', 'progress'].includes(tag) }).code
  options.render = new Function('Vue', code)(Vue)
  return options
}
async function render(file, locale, state = {}, props = {}) {
  const options = component(file), initial = options.data?.() || {}
  options.data = () => ({ ...initial, ...state })
  const app = Vue.createSSRApp(options, props)
  app.use(createI18n({ legacy: true, locale, fallbackLocale: 'zh-CN', messages }))
  return renderToString(app)
}

test('all client templates resolve fixed copy through locale keys, including aria labels', () => {
  for (const file of files) {
    const template = source(file).match(/<template>([\s\S]*?)<\/template>/)[1]
    assert.doesNotMatch(template, /[\p{Script=Han}]/u, file)
  }
})
test('the actual English workspace and portal renders contain no fixed Chinese copy', async () => {
  const workspace = await render(files[0], 'en-US', { cloudConnections: [{ id: 1, displayName: 'Test server' }] })
  assert.match(workspace, /Client collaboration/); assert.match(workspace, /Join project/)
  assert.match(workspace, /Official case library/); assert.match(workspace, /Enter invitation code/)
  assert.match(workspace, /System notifications are off/); assert.doesNotMatch(workspace, /[\p{Script=Han}]/u)
  const portal = await render(files[2], 'en-US')
  assert.match(portal, /Source code/); assert.match(portal, /https:\/\/github.com\/AI-WorkDeck\/aiworkdeck/)
  assert.doesNotMatch(portal, /[\p{Script=Han}]/u)
  assert.match(await render(files[0], 'zh-CN'), /客户协作/)
})
test('English checklist renders upload, AI consent, appeal, history and progress in English', async () => {
  const item = { id: 7, title: 'Business license', description: 'All pages', status: 'UPLOADED', exampleFileId: 3 }
  const state = { request: { name: 'Synthetic checklist', status: 'PUBLISHED' }, items: [item], selectedId: 7,
    submissions: { 7: { reviewStatus: 'REJECTED', aiStatus: 'FAILED', reviewReason: 'Missing page' } },
    history: [{ id: 9, submittedAt: '2026-10-22T01:00:00', files: [{ fileId: 4, name: 'license.pdf' }] }],
    pendingFiles: [{ name: 'updated.pdf' }], formMode: 'appeal', reason: 'All pages are included' }
  const html = await render(files[1], 'en-US', state, { requestId: 1, projectId: 2 })
  for (const text of ['All documents', 'Additional documents needed', 'View reference example', 'Latest submission', 'Download', 'Choose files', 'Take photo', 'Use AI to check', 'Submit files (1)', 'Submit review request']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /[\p{Script=Han}]/u)
  const uploading = await render(files[1], 'en-US', { ...state, busy: true, uploadProgress: 45 }, { requestId: 1, projectId: 2 })
  assert.match(uploading, /Uploading 45%/); assert.match(uploading, /Document upload progress/)
  const explanation = await render(files[1], 'en-US', { ...state, formMode: 'explanation' }, { requestId: 1, projectId: 2 })
  assert.match(explanation, /Currently unavailable/); assert.match(explanation, /Not applicable/)
  assert.match(explanation, /Submit explanation/); assert.doesNotMatch(explanation, /[\p{Script=Han}]/u)
})
test('checklist business names, requirements and lawyer reasons stay verbatim in English UI', async () => {
  const html = await render(files[1], 'en-US', { request: { name: '律师原始清单', status: 'PUBLISHED' },
    items: [{ id: 7, title: '客户营业执照', description: '请提供盖章原件', status: 'UPLOADED' }], selectedId: 7,
    submissions: { 7: { reviewStatus: 'REJECTED', reviewReason: '请补第二页', aiResultJson: JSON.stringify({ summary: '核验原文保持', checks: [] }) } } }, { requestId: 1, projectId: 2 })
  for (const businessText of ['律师原始清单', '客户营业执照', '请提供盖章原件', '请补第二页', '核验原文保持']) assert.ok(html.includes(businessText))
  assert.match(html, /Additional documents needed/)
})
function serviceFixture(locale, fetch) {
  const s = source('services/ddClient.js').replace(/^import .*$/gm, '').replace(/export /g, '')
  const i18n = createI18n({ legacy: true, locale, messages })
  return new Function('getApiBaseUrl', 'getCloudAccountGeneration', 'getAuthHeaders', 'getSessionId', 'isClientPortalBuild', 'getAppLanguage', 't', 'fetch', 'zhDdWorkflow', s + '\nreturn { ddClientJson, connectDdClient, ddClientRead, ddClientNotificationText, ddClientErrorMessage };')(
    () => 'https://case.example', () => 0, () => ({ 'X-Session-Id': 'personal' }), () => 'personal', () => true, () => locale, i18n.global.t, fetch, zh)
}
test('portal JSON requests carry the declared language and keep invitation sessions separate', async () => {
  const calls = []; const api = serviceFixture('en-US', async (url, options) => {
    calls.push({ url, ...options })
    return { status: 200, json: async () => url.endsWith('client-login') ? { code: 0, data: { sessionId: 'invited', projectId: 7 } } : { name: 'Case name' } }
  })
  const connection = await api.connectDdClient('synthetic-code')
  await api.ddClientRead({ connectionId: connection.id, projectId: 7 }, '/projects')
  assert.ok(calls.every(call => call.headers['X-App-Language'] === 'en-US'))
  assert.equal(calls[0].headers['X-Session-Id'], 'personal'); assert.equal(calls.at(-1).headers['X-Session-Id'], 'invited')
  assert.equal(connection.name, 'Case name')
})
test('notification translations preserve business titles and leave unfamiliar messages untouched', () => {
  const api = serviceFixture('en-US')
  assert.equal(api.ddClientNotificationText({ kind: 'PUBLISHED', title: '律师已发送尽调清单：收购项目：第一批' }), 'Your lawyer sent a due diligence checklist: 收购项目：第一批')
  assert.equal(api.ddClientNotificationText({ kind: 'REVIEW', title: '律师已退回：营业执照' }), 'Your lawyer requested changes: 营业执照')
  assert.equal(api.ddClientNotificationText({ kind: 'REVIEW', title: '律师已撤回审核：营业执照' }), 'Your lawyer withdrew the review: 营业执照')
  assert.equal(api.ddClientNotificationText({ kind: 'OTHER', title: '团队自行填写的消息' }), '团队自行填写的消息')
  assert.equal(serviceFixture('zh-CN').ddClientNotificationText({ kind: 'PUBLISHED', title: '律师已发送尽调清单：第一批' }), '律师已发送尽调清单：第一批')
})


test('known fixed server errors are translated without rewriting unfamiliar details', async () => {
  const api = serviceFixture('en-US', async () => ({ status: 403, json: async () => ({ message: '邀请已失效，请重新输入邀请码' }) }))
  await assert.rejects(api.ddClientJson('/anything'), /invitation is no longer valid/)
  assert.equal(api.ddClientErrorMessage('客户原样说明'), '客户原样说明')
  assert.equal(serviceFixture('zh-CN').ddClientErrorMessage('无权访问该清单'), '无权访问该清单')
})

test('portal invitation failures localize real access-code responses and keep Chinese intact', async () => {
  const responses = [
    ['访问码无效', 'This invitation code is invalid. Check the code and retry.'],
    ['访问码已失效', 'This invitation code has been revoked. Ask your lawyer for a new one.'],
    ['访问码已过期，请联系律师重新发送', 'This invitation code has expired. Ask your lawyer for a new one.'],
  ]
  for (const [message, english] of responses) {
    const fetch = async () => ({ status: 200, json: async () => ({ code: 1, message }) })
    await assert.rejects(serviceFixture('en-US', fetch).connectDdClient('invalid-code'), { message: english })
    await assert.rejects(serviceFixture('zh-CN', fetch).connectDdClient('invalid-code'), { message })
  }
})
