// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Synthetic protocol fixture only; never a production service or payment provider.
import http from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const port = Number(process.env.PROVIDER_PORT || 19853)
const audit = process.env.PROVIDER_AUDIT || join(tmpdir(), 'plugin-services-provider-events.jsonl')
const callbackOrigin = process.env.CALLBACK_ORIGIN || 'http://127.0.0.1:19851'
const grants = new Map(), codes = new Map(), tokens = new Map([['test-only-bearer-token', 'bearer']]), subscriptions = new Set()
const events = []
const tool = { name: 'echo', description: '回显输入文本，用于验证服务连接与工具调用。', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }
function record(operation, extra = {}) { const event = { time: new Date().toISOString(), operation, ...extra }; events.push(event); appendFileSync(audit, JSON.stringify(event) + '\n') }
function html(res, body, status = 200) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><title>合成服务验收</title><style>body{font:16px system-ui;max-width:700px;margin:40px auto;line-height:1.6}button,select{padding:12px;font:inherit}small{display:block;color:#555}</style>' + body + '</html>') }
function json(res, data, status = 200, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(data)) }
async function body(req) { let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 100000) throw Error('too large') } return data }
function account(req) { return tokens.get((req.headers.authorization || '').replace(/^Bearer /, '')) }
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:' + port), path = url.pathname
    if (path === '/health') return json(res, { synthetic: true, ok: true, port })
    if (path === '/evidence') return json(res, { synthetic: true, events })
    if (path === '/oauth/authorize' && req.method === 'GET') {
      const args = Object.fromEntries(url.searchParams)
      if (args.client_id !== 'plugin-service-demo' || args.response_type !== 'code' || args.code_challenge_method !== 'S256' || !args.code_challenge || !args.state || args.redirect_uri !== callbackOrigin + '/api/plugins/oauth/callback') return html(res, '<h1>授权参数无效</h1>', 400)
      const id = randomUUID(); grants.set(id, args); record('oauth.authorize', { pkce: true })
      return html(res, '<h1>合成 OAuth 服务</h1><p>当前是隔离测试账号，不会访问个人资料。</p><form method="post" action="/oauth/authorize"><input type="hidden" name="grant" value="' + id + '"><button name="decision" value="allow">授权合成账号</button> <button name="decision" value="deny">拒绝授权</button></form>')
    }
    if (path === '/oauth/authorize' && req.method === 'POST') {
      const form = new URLSearchParams(await body(req)), grant = form.get('grant'), args = grants.get(grant); grants.delete(grant)
      if (!args) return html(res, '<h1>授权会话已失效</h1>', 400)
      const callback = new URL(args.redirect_uri); callback.searchParams.set('state', args.state)
      if (form.get('decision') === 'allow') { const code = randomUUID(); codes.set(code, args); callback.searchParams.set('code', code); record('oauth.consent', { accepted: true }) }
      else { callback.searchParams.set('error', 'access_denied'); record('oauth.consent', { accepted: false }) }
      res.writeHead(302, { Location: callback.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return res.end()
    }
    if (path === '/oauth/token' && req.method === 'POST') {
      const form = new URLSearchParams(await body(req)), code = form.get('code'), args = codes.get(code); codes.delete(code)
      const valid = args && form.get('grant_type') === 'authorization_code' && form.get('client_id') === args.client_id && form.get('redirect_uri') === args.redirect_uri && createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') === args.code_challenge
      record('oauth.exchange', { valid: !!valid, pkce: !!valid })
      if (!valid) return json(res, { error: 'invalid_grant' }, 400)
      const token = 'test-only-oauth-' + randomUUID(); tokens.set(token, 'oauth')
      return json(res, { access_token: token, token_type: 'Bearer', expires_in: 3600, scope: 'profile' })
    }
    if (path === '/plans' && req.method === 'GET') return html(res, '<h1>合成订阅验收</h1><p>此页面仅改变测试服务的内存状态。不会产生订单或扣款。</p><form method="post" action="/plans"><label>合成账号 <select name="account"><option value="bearer">Bearer 账号</option><option value="oauth">OAuth 账号</option></select></label> <button name="action" value="activate">激活合成订阅</button></form>')
    if (path === '/plans' && req.method === 'POST') {
      const form = new URLSearchParams(await body(req)), who = form.get('account')
      if (!['bearer', 'oauth'].includes(who)) return html(res, '<h1>未知测试账号</h1>', 400)
      subscriptions.add(who); record('subscription.activate', { account: who, charged: false }); return html(res, '<h1>合成订阅已激活</h1><p>未扣款。请返回宿主重新查询服务商订阅。</p>')
    }
    const who = account(req)
    if (!who) { record('unauthorized', { path }); return json(res, { error: 'invalid_token' }, 401) }
    if (path === '/v1/subscription') { record('subscription.status', { account: who, active: subscriptions.has(who) }); return json(res, { active: subscriptions.has(who), plan: subscriptions.has(who) ? 'Synthetic plan' : 'none' }) }
    if (path === '/v1/query' && req.method === 'POST') {
      const params = JSON.parse(await body(req) || '{}'), input = String(params.input || '')
      record('query.start', { account: who, inputLength: input.length, mode: input === 'fail' || input === 'slow' ? input : 'normal' })
      if (input === 'slow') await new Promise(resolve => setTimeout(resolve, 5000))
      if (input === 'fail') return json(res, { error: 'synthetic_query_failure' }, 503)
      record('query.complete', { account: who }); return json(res, { account: who, result: '合成服务收到：' + input, synthetic: true })
    }
    if (path === '/mcp' && req.method === 'DELETE') { res.writeHead(204); return res.end() }
    if (path === '/mcp' && req.method === 'POST') {
      const request = JSON.parse(await body(req)), { id, method, params } = request
      record('mcp.' + method, { account: who })
      if (method === 'notifications/initialized') { res.writeHead(202); return res.end() }
      let result
      if (method === 'initialize') result = { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'synthetic-plugin-provider', version: '1.0.0' } }
      else if (method === 'tools/list') result = { tools: [tool] }
      else if (method === 'tools/call' && params.name === 'echo') {
        const text = params.arguments?.text
        if (text === 'slow') await new Promise(resolve => setTimeout(resolve, 5000))
        result = { content: [{ type: 'text', text: typeof text !== 'string' || text === 'fail' ? '合成工具拒绝此次输入' : '合成 MCP 回显：' + text }], isError: typeof text !== 'string' || text === 'fail' }
      } else return json(res, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
      return json(res, { jsonrpc: '2.0', id, result }, 200, { 'Mcp-Session-Id': 'synthetic-' + who })
    }
    return json(res, { error: 'not_found' }, 404)
  } catch { json(res, { error: 'synthetic_fixture_error' }, 400) }
})
server.listen(port, '127.0.0.1', () => console.log('Synthetic provider on 127.0.0.1:' + port))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
