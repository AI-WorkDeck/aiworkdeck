// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 问题 91：升级后 codesign -v --deep 报 sealed resource invalid——包内 Python 在
// Contents/Resources/python/lib/** 下写了 __pycache__/*.pyc。凡是会拉起包内 Python 的 env
// 都要带 PYTHONDONTWRITEBYTECODE=1（native/editor-session.js 是先例）；后端 env 也带上，
// 后端再起的 Python 子进程（诉讼可视化等）会继承。
// 这些模块建 env 时依赖打包路径与端口，没有可直接调用的纯函数出口，按源码口径守住。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const read = (f) => fs.readFileSync(path.join(__dirname, '../main/services', f), 'utf8')

test('拉起包内 Python 的每个 env 字面量都带 PYTHONDONTWRITEBYTECODE=1', () => {
  for (const f of ['asr-service.js', 'kokoro-service.js', 'mineru-service.js', 'pptx-service.js', 'model-manager.js']) {
    const src = read(f)
    const spreads = (src.match(/\.\.\.process\.env\b/g) || []).length
    const flags = (src.match(/PYTHONDONTWRITEBYTECODE: '1'/g) || []).length
    assert.ok(spreads > 0, f)
    assert.equal(flags, spreads, `${f}: ${spreads} 处 env 只有 ${flags} 处带 PYTHONDONTWRITEBYTECODE`)
  }
})

test('后端 env 带 PYTHONDONTWRITEBYTECODE=1，供其 Python 子进程继承', () => {
  assert.match(read('backend-service.js'), /env\.PYTHONDONTWRITEBYTECODE = '1'/)
})
