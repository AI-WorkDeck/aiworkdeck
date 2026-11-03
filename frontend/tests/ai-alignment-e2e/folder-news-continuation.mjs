#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real isolated backend/H2/files/tools, deterministic local OpenAI-compatible HTTP fixture.
// This verifies the continuation protocol, not a real provider's reasoning quality.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const repo = fileURLToPath(new URL('../../../', import.meta.url))
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-news-continuation-'))
const home = path.join(out, 'home')
fs.mkdirSync(home, { recursive: true })
const jarSource = process.env.FOLDER_NEWS_JAR
assert.ok(jarSource && fs.existsSync(jarSource), 'Set FOLDER_NEWS_JAR to the freshly built backend jar')
const jar = path.join(out, 'runtime.jar')
fs.copyFileSync(jarSource, jar)
let child, modelServer, abortStream
let ids, originalPrompt, streamText = '', phase = 0
const requests = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, timeout = 120000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const result = await fn(); if (result) return result; await sleep(200) }
  throw Error(`Timeout: ${label}`)
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}
let base
async function api(endpoint, body) {
  const response = await fetch(base + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  assert.ok(response.ok, `${endpoint}: ${response.status} ${text.slice(0, 200)}`)
  const value = text ? JSON.parse(text) : null
  if (value && typeof value.code === 'number') assert.ok(value.code === 0 || value.code === 200, `${endpoint}: business error ${value.code}`)
  return value
}
const tool = (name, args) => `<process name="核实材料"><tool_code>${name}(${JSON.stringify(args)})</tool_code></process>`
try {
  modelServer = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    if (req.url === '/api/account/me') return json({ username: 'fixture', accountId: 'acc_fixture', plan: 'paid' })
    if (req.url === '/api/account/ai-key') return json({ provider: 'bailian', apiKey: 'awdai_fixture_only', baseUrl: `http://${req.headers.host}/api/account/ai/v1`, defaultModel: 'fixture', limitUsd: 100 })
    if (req.url === '/api/account/ai-usage') return json({ configured: true, hasKey: true, creditsCents: 100000, limitUsd: 100, usageUsd: 0, remainingUsd: 100 })
    if (req.url === '/api/account/entitlements') return json({ entitlements: [] })
    if (req.url === '/api/account/membership') return json({ tier: 'pro', creditsCents: 100000 })
    if (req.url.endsWith('/models')) return json({ defaultModel: 'fixture', models: [{ id: 'fixture', name: 'Fixture', contextLength: 131072, maxOutputTokens: 8192, supportsTools: true, supportsVision: false, inputPricePerMillion: 0, outputPricePerMillion: 0 }] })
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end(); return }
    const body = JSON.parse(raw || '{}')
    const main = body.stream === true
    if (!main) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ id: 'helper', choices: [{ message: { role: 'assistant', content: '合成活动短讯' }, finish_reason: 'stop' }] })); return
    }
    requests.push(body)
    fs.writeFileSync(path.join(out, 'model-requests.json'), JSON.stringify(requests, null, 2))
    if (phase++ < 2) { res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'synthetic upstream unavailable' })); return }
    try {
      const messages = body.messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n')
      assert.ok(messages.includes('参考旧短讯'), 'Original task instruction must survive failure')
      assert.ok(messages.includes(`<active_document id="${ids.reference}"`), 'Current old Word context must remain present during target-folder work')
      let content
      switch (phase) {
        case 3: {
          const manifest = messages.match(/list_attached_files\(messageId=(\d+), afterId=0\)/)
          assert.ok(manifest, 'Historical attachment manifest must survive continuation without contextItems')
          content = tool('list_attached_files', { messageId: Number(manifest[1]), afterId: 0 }); break
        }
        case 4: {
          const folder = messages.match(/\[folder\] fileId=(\d+) name=新活动材料/)
          const reference = messages.match(/\[file\] fileId=(\d+) name=旧短讯\.docx/)
          assert.ok(folder && reference, 'Actual manifest tool result must expose both references')
          ids.discoveredFolder = Number(folder[1]); ids.discoveredReference = Number(reference[1])
          assert.equal(ids.discoveredFolder, ids.folder); assert.equal(ids.discoveredReference, ids.reference)
          content = tool('extract_file_text', { fileId: ids.discoveredReference }); break
        }
        case 5:
          assert.ok(messages.includes('OLD_EVENT_918'), 'Read the old short news as format reference')
          content = tool('extract_file_text', { fileId: ids.discoveredFolder, offset: 0, maxChars: 12000 }); break
        case 6: {
          const a = messages.match(/id=(\d+), [^\n]*活动安排\.txt/)
          const b = messages.match(/id=(\d+), [^\n]*交流记录\.txt/)
          assert.ok(a && b, 'Actual folder listing must supply both source IDs')
          ids.discoveredA = Number(a[1]); ids.discoveredB = Number(b[1])
          content = tool('extract_file_text', { fileId: ids.discoveredA }); break
        }
        case 7:
          assert.ok(messages.includes('NEW_ACTIVITY_421'))
          content = tool('extract_file_text', { fileId: ids.discoveredB }); break
        case 8:
          assert.ok(messages.includes('NEW_ACTIVITY_421') && messages.includes('SPEAKERS_729'), 'Both actual tool results must reach model before writing')
          content = tool('write_docx', { fileName: '新活动短讯.docx', parentFolderId: ids.discoveredFolder, projectId: ids.project, markdownContent: '# 新活动走访短讯\n\n2026年11月3日，合成委员会走访新活动研究中心，共23人参加。\n\n交流围绕电子证据与在线庭审展开，李甲介绍平台，王乙主持讨论。' }); break
        default: content = '<final>已根据新活动两份材料写成短讯，旧稿仅作为格式参考。</final>'
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] }) + '\n\n')
      res.write('data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n')
      res.end('data: [DONE]\n\n')
    } catch (e) { fs.writeFileSync(path.join(out, 'fixture-failure.txt'), e.stack); res.writeHead(500).end(JSON.stringify({ error: e.message })) }
  })
  const modelPort = await listen(modelServer)
  fs.mkdirSync(path.join(home, '.aiworkdeck'), { recursive: true })
  fs.writeFileSync(path.join(home, '.aiworkdeck/account.json'), JSON.stringify({ key: 'awdk_fixture_only', accountId: 'acc_fixture', username: 'fixture' }))
  const reservation = http.createServer(); const port = await listen(reservation); await new Promise(resolve => reservation.close(resolve))
  base = `http://127.0.0.1:${port}`
  const log = fs.openSync(path.join(out, 'backend.log'), 'w')
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java'
  child = spawn(java, ['-Duser.home=' + home, '-Dai.account.base-url=http://127.0.0.1:' + modelPort, '-Dai.model.open-router.base-url=http://127.0.0.1:' + modelPort + '/v1', '-jar', jar, '--server.port=' + port], {
    cwd: home, env: { ...process.env, SPRING_PROFILES_ACTIVE: 'desktop', SPRING_DATASOURCE_URL: `jdbc:h2:file:${home}/db;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE`, AI_SKILLS_BUILTIN_DIR: path.join(repo, 'backend/skills') }, stdio: ['ignore', log, log],
  })
  await until(() => fetch(base + '/api/auth/me').then(r => r.ok).catch(() => false), 'isolated backend ready')
  const project = await api('/api/projects', { name: 'QA-旧短讯新活动', projectType: 'BLANK' })
  const filesUrl = `/api/projects/${project.id}/files`
  const source = path.join(out, 'sources'); fs.mkdirSync(source)
  const referencePath = path.join(source, '旧短讯.docx')
  execFileSync('python3', ['-c', `import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>旧活动沙龙：2026年10月19日，旧机构举办AI主题沙龙，16人参加。OLD_EVENT_918。活动中介绍AI工具，随后交流讨论。</w:t></w:r></w:p></w:body></w:document>')`, referencePath])
  const reference = (await api(filesUrl + '/import-local', { sourcePath: referencePath })).data
  const referenceBefore = Buffer.from(await (await fetch(base + `/api/files/${reference.id}/download`)).arrayBuffer())
  const folder = await api(filesUrl + '/folder', { name: '新活动材料' })
  const texts = [['活动安排.txt', 'NEW_ACTIVITY_421：2026年11月3日，合成委员会走访新活动研究中心，共23人参加。'], ['交流记录.txt', 'SPEAKERS_729：李甲介绍平台，王乙主持讨论，议题为电子证据与在线庭审。']]
  const imported = []
  for (const [name, content] of texts) { const p = path.join(source, name); fs.writeFileSync(p, content); imported.push((await api(filesUrl + '/import-local', { sourcePath: p, parentId: folder.id })).data) }
  ids = { project: project.id, reference: reference.id, folder: folder.id, a: imported[0].id, b: imported[1].id }
  originalPrompt = process.env.FOLDER_NEWS_INLINE === '1'
    ? `请参考旧短讯 @{"fileId":"${reference.id}","name":"旧短讯.docx"} 的格式，为 @{"folderId":"${folder.id}","name":"新活动材料"} 写一份新活动短讯，事实以新活动材料为准。`
    : '请参考旧短讯的格式，为新活动材料写一份新活动短讯，事实以新活动材料为准。'
  const conversationId = `conv-folder-news-${Date.now()}`
  const streamTasks = []
  const openStream = async () => {
    abortStream?.abort()
    abortStream = new AbortController()
    const response = await fetch(base + `/api/agent/connect/${conversationId}`, { signal: abortStream.signal })
    const decoder = new TextDecoder()
    streamTasks.push((async () => { try { for await (const part of response.body) streamText += decoder.decode(part, { stream: true }) } catch {} })())
  }
  await openStream()
  const request = { projectId: String(project.id), conversationId, model: 'fixture', mode: 'AGENT', clientCapability: 'lowa', activeContext: { id: String(reference.id), name: reference.name, fileType: 'docx' }, message: originalPrompt, contextItems: [{ id: String(reference.id), name: reference.name, fileType: 'docx', isDir: false }, { id: String(folder.id), name: folder.name, fileType: 'folder', isDir: true }] }
  await api('/api/agent/chat', request)
  await until(() => /event:\s*error/.test(streamText), 'first model failure', 30000)
  assert.equal(requests.length, 1, 'Failure must not automatically replay user work')
  await sleep(500)
  const failuresBefore = (streamText.match(/event:\s*error/g) || []).length
  await openStream()
  await api('/api/agent/chat', { ...request, message: '继续', contextItems: [] })
  await until(() => (streamText.match(/event:\s*error/g) || []).length > failuresBefore, 'second model failure', 30000)
  assert.equal(requests.length, 2)
  await sleep(500)
  await openStream()
  await api('/api/agent/chat', { ...request, message: '继续', contextItems: [] })
  await until(() => streamText.includes('旧稿仅作为格式参考'), 'resumed final', 60000)
  const history = await api(`/api/ai/history?conversationId=${conversationId}`)
  assert.equal(history.filter(m => m.role === 'USER').length, 3)
  assert.equal(history.find(m => m.role === 'USER').content, originalPrompt)
  const files = await api(filesUrl + '?parentId=' + folder.id)
  const output = files.find(f => f.name === '新活动短讯.docx')
  assert.ok(output, 'Real write_docx output must exist')
  const download = await fetch(base + `/api/files/${output.id}/download`)
  assert.ok(download.ok, 'Generated DOCX must be downloadable')
  const outputPath = path.join(out, 'new-activity.docx')
  fs.writeFileSync(outputPath, Buffer.from(await download.arrayBuffer()))
  const xml = execFileSync('python3', ['-c', 'import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode())', outputPath], { encoding: 'utf8' })
  for (const fact of ['2026年11月3日', '23人', '李甲', '王乙']) assert.ok(xml.includes(fact), fact)
  assert.ok(!xml.includes('OLD_EVENT_918') && !xml.includes('16人'))
  assert.equal(output.parentId, folder.id)
  const referenceAfter = Buffer.from(await (await fetch(base + `/api/files/${reference.id}/download`)).arrayBuffer())
  assert.ok(referenceBefore.equals(referenceAfter), 'Old reference document must remain byte-identical')
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: true, ids, outputId: output.id, modelRequests: requests.length, boundary: 'Scripted model; real backend, database, extraction and DOCX tools. Not provider-quality or GUI validation.' }, null, 2))
  console.log('PASS folder-news-continuation', out)
  abortStream.abort(); await Promise.all(streamTasks)
} finally {
  abortStream?.abort()
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 35000).unref())])
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  modelServer?.closeAllConnections(); if (modelServer) await new Promise(resolve => modelServer.close(resolve))
  console.log('Evidence:', out)
}
