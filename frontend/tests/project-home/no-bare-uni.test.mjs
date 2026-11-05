// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// uni-h5 构建只把 `uni.xxx` 成员访问替换成导入；裸标识符 `uni`（当参数传、当返回值、赋给变量）
// 在浏览器里是 window.uni = {} 的空壳，经它调 getStorageSync / setStorageSync 全部静默失效
// （单测靠 globalThis.uni 替身测不出来）。dev-board#1713
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BARE_UNI = /[(,:=?] *uni *[,)};:]|[(,:=?] *uni *$|\{ *uni *[,}]|\breturn uni(?![.\w$])/

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name)
    if (name.isDirectory()) { if (name.name !== 'node_modules') walk(p, out) } else if (/\.(js|vue|ts|mjs)$/.test(name.name)) out.push(p)
  }
  return out
}

test('源码里没有把裸 uni 当对象传递或返回', () => {
  const hits = []
  for (const dir of ['src', 'plugin-app']) {
    const base = path.join(root, dir)
    if (!fs.existsSync(base)) continue
    for (const file of walk(base)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (BARE_UNI.test(line)) hits.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`)
      })
    }
  }
  assert.deepEqual(hits, [])
})
