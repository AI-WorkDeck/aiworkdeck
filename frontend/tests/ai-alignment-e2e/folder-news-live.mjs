#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// One explicitly enabled real-provider scenario; synthetic files, isolated backend/H2.
// No scripted model responses or prescribed tool sequence are sent to the model.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const repo = fileURLToPath(new URL('../../../', import.meta.url))
assert.equal(process.env.FOLDER_NEWS_ALLOW_REAL, '1', 'Explicit real-model authorization required')
const qaDir = process.env.FOLDER_NEWS_QA_DIR
const qaIdentity = process.env.FOLDER_NEWS_QA_IDENTITY
assert.ok(qaDir && qaIdentity, 'Set FOLDER_NEWS_QA_DIR and FOLDER_NEWS_QA_IDENTITY to the dedicated QA account and identity paths')
const accountId = JSON.parse(fs.readFileSync(path.join(qaDir, 'account.json'), 'utf8')).accountId
const expectedAccountId = JSON.parse(fs.readFileSync(qaIdentity, 'utf8')).expectedAccountId
assert.ok(accountId && expectedAccountId && accountId === expectedAccountId, 'Dedicated QA identity must match; do not use a personal account')
assert.ok(fs.existsSync(path.join(qaDir, 'account.json')), 'QA account must be connected in its original location')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-news-live-'))
const home = path.join(out, 'home')
fs.mkdirSync(home, { recursive: true })
const jarSource = process.env.FOLDER_NEWS_JAR
assert.ok(jarSource && fs.existsSync(jarSource), 'Set FOLDER_NEWS_JAR to the freshly built backend jar')
const jar = path.join(out, 'runtime.jar')
fs.copyFileSync(jarSource, jar)
let child, abortStream
let ids, originalPrompt, conversationId, streamText = ''
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
try {
  const reservation = http.createServer(); const port = await listen(reservation); await new Promise(resolve => reservation.close(resolve))
  base = `http://127.0.0.1:${port}`
  const log = fs.openSync(path.join(out, 'backend.log'), 'w')
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java'
  child = spawn(java, ['-Duser.home=' + home, '-Dsecurity.license.dir=' + qaDir, '-jar', jar, '--server.port=' + port], {
    cwd: home, env: { ...process.env, SPRING_PROFILES_ACTIVE: 'desktop', SPRING_DATASOURCE_URL: `jdbc:h2:file:${home}/db;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE`, AI_SKILLS_BUILTIN_DIR: path.join(repo, 'backend/skills') }, stdio: ['ignore', log, log],
  })
  await until(() => fetch(base + '/api/auth/me').then(r => r.ok).catch(() => false), 'isolated backend ready')
  const route = await api('/api/ai/config')
  assert.equal(route.activeProvider, 'AWD_CLOUD')
  assert.equal(route.platformAiAvailable, true)
  const catalogue = await api('/api/ai/models')
  const model = catalogue.models.find(m => m.id === 'qwen3.8-max')
  assert.ok(model && model.tools, 'Requested qwen3.8-max with tools must exist in actual provider catalogue')
  fs.writeFileSync(path.join(out, 'model.json'), JSON.stringify({ id: model.id, tools: model.tools }, null, 2))
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
  originalPrompt = `请参考这个文档 @{"fileId":"${reference.id}","name":"旧短讯.docx"}，写一下 @{"folderId":"${folder.id}","name":"新活动材料"} 这个活动的短讯，另存为一个新的Word文件，不修改旧稿。`
  conversationId = `conv-folder-news-${Date.now()}`
  abortStream = new AbortController()
  const streamResponse = await fetch(base + `/api/agent/connect/${conversationId}`, { signal: abortStream.signal })
  const decoder = new TextDecoder()
  const streamTask = (async () => { try { for await (const part of streamResponse.body) streamText += decoder.decode(part, { stream: true }) } catch {} })()
  const request = { projectId: String(project.id), conversationId, model: model.id, mode: 'AGENT', message: originalPrompt, contextItems: [{ id: String(reference.id), name: reference.name, fileType: 'docx', isDir: false }, { id: String(folder.id), name: folder.name, fileType: 'folder', isDir: true }] }
  await api('/api/agent/chat', request)
  await until(() => /event:\s*(?:bubble_end|error|agent_paused|question)/.test(streamText), 'single real model turn', 240000)
  fs.writeFileSync(path.join(out, 'sse.txt'), streamText)
  assert.ok(!/event:\s*error/.test(streamText), 'Provider failed; preserved evidence; no automatic retry')
  const history = await api(`/api/ai/history?conversationId=${conversationId}`)
  assert.equal(history.filter(m => m.role === 'USER').length, 1)
  assert.equal(history.find(m => m.role === 'USER').content, originalPrompt)
  fs.writeFileSync(path.join(out, 'history.json'), JSON.stringify(history, null, 2))
  const files = await api(filesUrl + '?tree=true')
  const flatten = items => items.flatMap(f => [f, ...flatten(f.children || [])])
  const outputs = flatten(files).filter(f => f.fileType === 'docx' && f.id !== reference.id)
  assert.equal(outputs.length, 1, 'Exactly one new DOCX required')
  const output = outputs[0]
  assert.ok(output, 'Real write_docx output must exist')
  const download = await fetch(base + `/api/files/${output.id}/download`)
  assert.ok(download.ok, 'Generated DOCX must be downloadable')
  const outputPath = path.join(out, 'new-activity.docx')
  fs.writeFileSync(outputPath, Buffer.from(await download.arrayBuffer()))
  const xml = execFileSync('python3', ['-c', 'import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode())', outputPath], { encoding: 'utf8' })
  const plain = xml.replace(/<[^>]+>/g, '')
  for (const fact of ['11月3日', '李甲', '王乙']) assert.ok(plain.includes(fact), fact)
  assert.match(plain, /23[人名]/)
  assert.ok(!xml.includes('OLD_EVENT_918') && !xml.includes('16人'))
  const assistantText = history.filter(m => m.role === 'ASSISTANT').map(m => m.content || '').join('\n')
  const reads = [...assistantText.matchAll(/<tool_code>([\s\S]*?)<\/tool_code>/g)].map(m => m[1]).filter(c => /extract_file_text|read_document|ref_read/.test(c))
  for (const id of [ids.a, ids.b]) assert.ok(reads.some(c => new RegExp('\\b' + id + '\\b').test(c)), 'Missing source read evidence: ' + id)
  assert.ok(assistantText.includes('NEW_ACTIVITY_421') && assistantText.includes('SPEAKERS_729'), 'Both source bodies must appear in actual read results')
  const referenceAfter = Buffer.from(await (await fetch(base + `/api/files/${reference.id}/download`)).arrayBuffer())
  assert.ok(referenceBefore.equals(referenceAfter), 'Old reference document must remain byte-identical')
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ passed: true, ids, outputId: output.id, model: model.id, boundary: 'Real provider, backend, H2, source extraction and DOCX output; API-driven, not GUI or installed-client validation.' }, null, 2))
  console.log('PASS folder-news-live', out)
  abortStream.abort(); await streamTask
} finally {
  fs.writeFileSync(path.join(out, 'sse.txt'), streamText)
  if (conversationId && base) await api('/api/agent/cancel/' + conversationId, {}).catch(() => {})
  abortStream?.abort()
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 35000).unref())])
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  console.log('Evidence:', out)
}
