// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 问题 23（dev-board#1713）：两个实例同时跑时，编辑器静态服务的首选端口
// （zetaoffice 47613 / draw.io 47614）已被另一个实例占着，后起的实例必须换一个空闲端口，
// 并且交给渲染层的 origin / 编辑器 URL 用的是实际端口。
//
// 本文件不真去绑 47613/47614（开发机上常有正在用的实例）：把对这两个端口的 listen
// 重定向到一个本测试已经占住的端口，模拟「被别的实例占用」。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')
const path = require('node:path')
const http = require('node:http')

async function occupyAndRedirect(t, fixedPort) {
  const holder = net.createServer()
  await new Promise((r) => holder.listen(0, '127.0.0.1', r))
  const busy = holder.address().port
  const listen = net.Server.prototype.listen
  const seen = []
  const servers = new Set()
  net.Server.prototype.listen = function (...args) {
    seen.push(args[0])
    servers.add(this)
    if (args[0] === fixedPort) args[0] = busy
    return listen.apply(this, args)
  }
  // zetaoffice-server 没有 stop（随应用生命周期），测试里手动关掉，进程才能退出
  t.after(() => {
    net.Server.prototype.listen = listen
    holder.close()
    for (const s of servers) { try { s.closeAllConnections?.(); s.close() } catch (e) { /* 已关 */ } }
  })
  return { busy, seen }
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    }).on('error', reject)
  })
}

test('zetaoffice：47613 被别的实例占着时换空闲端口，编辑器 URL 用实际端口', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-zeta-port-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  // zetaoffice-server 顶层 require('electron').app：用假 app 顶上（dev 态，编辑器根 = 源树 dist）
  const electronId = require.resolve('electron')
  const saved = require.cache[electronId]
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true,
    exports: { app: { isPackaged: false, getVersion: () => '0.0.0', getPath: () => root } } }
  t.after(() => { if (saved) require.cache[electronId] = saved; else delete require.cache[electronId] })

  const { busy, seen } = await occupyAndRedirect(t, 47613)
  const { startEditorServer, editorUrl } = require('../main/zetaoffice-server')
  const { port, origin } = await startEditorServer()
  assert.equal(seen[0], 47613, '无冲突时仍优先 47613')
  assert.notEqual(port, busy)
  assert.ok(port > 0)
  assert.equal(origin, 'http://127.0.0.1:' + port)
  const url = new URL(editorUrl(origin, { uilang: 'zh-CN' }))
  assert.equal(url.origin, origin)
  assert.equal(url.searchParams.get('lowa'), origin + '/lowa/', 'LOWA 同源代理也要用实际端口')
  // 换过端口的服务确实在响应（未知 LOWA 资源 404，说明请求进了这个服务）
  assert.equal((await get(origin + '/lowa/not-a-real-asset')).status, 404)
})

test('draw.io：47614 被别的实例占着时换空闲端口，URL 用实际端口', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-drawio-port-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>drawio</html>')
  process.env.AIWORKDECK_DRAWIO_DIR = dir
  t.after(() => { delete process.env.AIWORKDECK_DRAWIO_DIR })

  const { busy, seen } = await occupyAndRedirect(t, 47614)
  const { startDrawioServer, stopDrawioServer, drawioUrl } = require('../main/drawio-server')
  const { port, origin } = await startDrawioServer()
  t.after(() => stopDrawioServer())
  assert.equal(seen[0], 47614, '无冲突时仍优先 47614')
  assert.notEqual(port, busy)
  assert.equal(new URL(drawioUrl(origin)).origin, origin)
  const res = await get(origin + '/index.html')
  assert.equal(res.status, 200)
  assert.match(res.body, /drawio/)
})

// 写死端口的地方只能是两个服务自己的首选常量；渲染层、preload、主进程其它模块都必须用 IPC 给的 origin。
test('除首选端口常量外，壳与前端源码不写死 47613/47614', () => {
  const roots = [path.join(__dirname, '../main'), path.join(__dirname, '../preload'),
    path.join(__dirname, '../../frontend/src')]
  const allowed = new Set([path.join(__dirname, '../main/zetaoffice-server.js'), path.join(__dirname, '../main/drawio-server.js')])
  const offenders = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const en of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, en.name)
      if (en.isDirectory()) { if (en.name !== 'node_modules') walk(p); continue }
      if (!/\.(js|mjs|cjs|vue|ts|html|json)$/.test(en.name) || allowed.has(p)) continue
      if (/4761[34]/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(path.join(__dirname, '../..'), p))
    }
  }
  roots.forEach(walk)
  assert.deepEqual(offenders, [])
})
