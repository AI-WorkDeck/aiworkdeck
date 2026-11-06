#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 给本地开发后端灌一个演示项目（纯虚构的买卖合同纠纷材料，fixtures/evidence-demo-1076）。
// 走公开 HTTP 接口，不碰数据库；同名项目已存在就跳过，可重复执行。
// 用法：node scripts/quickstart/seed-demo.mjs [backendBaseUrl]

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = (process.argv[2] || 'http://127.0.0.1:9696').replace(/\/$/, '')
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = path.join(repo, 'fixtures/evidence-demo-1076')
const PROJECT_NAME = '演示案件：买卖合同纠纷'
const FILES = ['01-购销合同.docx', '02-补充协议.docx', '03-签收单.docx', '04-沟通记录.docx']

async function api(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body instanceof FormData || !body ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok && json?.reason !== 'VERSION_BUSY') {
    throw new Error(`${method} ${url} -> HTTP ${res.status} ${JSON.stringify(json)}`)
  }
  return json
}

// 最后一行输出项目 id，quickstart.sh 用它拼浏览器地址
const projects = await api('GET', '/api/projects/my')
const existing = Array.isArray(projects) && projects.find(p => p.name === PROJECT_NAME)
if (existing) {
  console.log(`演示项目「${PROJECT_NAME}」已存在，跳过`)
  console.log(existing.id)
  process.exit(0)
}

const project = await api('POST', '/api/projects', { projectType: 'BLANK', name: PROJECT_NAME })
if (!project?.id) throw new Error('创建演示项目失败：' + JSON.stringify(project))

for (const name of FILES) {
  const bytes = await readFile(path.join(fixtureDir, name))
  const file = await api('POST', `/api/projects/${project.id}/files/file`,
    { name, fileType: 'docx', fileSize: bytes.length })
  if (!file?.id) throw new Error(`创建文件 ${name} 失败：` + JSON.stringify(file))
  // 新项目的版本库刚建好时上传会回 VERSION_BUSY，稍等重试
  for (let attempt = 1; ; attempt++) {
    const form = new FormData()
    form.append('file', new Blob([bytes]), name)
    const res = await api('POST', `/api/files/${file.id}/upload`, form)
    if (res?.code === 0) break
    if (res?.reason !== 'VERSION_BUSY' || attempt >= 30) {
      throw new Error(`上传 ${name} 失败：` + JSON.stringify(res))
    }
    await new Promise(r => setTimeout(r, 1000))
  }
}
console.log(`已创建演示项目「${PROJECT_NAME}」，含 ${FILES.length} 份材料`)
console.log(project.id)
