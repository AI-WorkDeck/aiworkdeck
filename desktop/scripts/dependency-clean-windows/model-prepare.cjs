// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real product downloader and inventory, without Electron's application lifecycle or mocks.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const [resources, repo, root] = process.argv.slice(2)
if (!resources || !repo || !root) throw new Error('Usage: node model-prepare.cjs RESOURCES REPO OUTPUT')
const { saveInventory, checkInventory, MARKER } = require(path.join(repo, 'desktop/main/services/model-inventory.js'))
const { libDirFor } = require(path.join(repo, 'desktop/main/services/pysvc-runtime.js'))
const python = path.join(resources, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3.11')
const script = path.join(repo, 'desktop/main/services/model-fetch.py')
const report = { node: process.version, python, downloaderSha256: crypto.createHash('sha256').update(fs.readFileSync(script)).digest('hex'), models: [] }
function run(args, env, log) {
  return new Promise((resolve, reject) => {
    const fd = fs.openSync(log, 'w')
    const child = spawn(python, args, { env, cwd: root, stdio: ['ignore', fd, fd], windowsHide: true })
    fs.closeSync(fd)
    let timedOut = false
    // A 1.5 GB model can take more than nine minutes while steadily progressing.
    // Bound each source separately; real-models.ps1 also caps total preparation.
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 20 * 60 * 1000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); resolve({ code, timedOut }) })
  })
}
async function main() {
  for (const [name, model] of [['asr', 'Systran/faster-whisper-medium'], ['kokoro', 'hexgrad/Kokoro-82M-v1.1-zh']]) {
    const dir = path.join(root, 'models', name)
    const lib = libDirFor({ dataDir: root, packaged: true }, name + '-service')
    if (!lib) throw new Error('Production pack resolution failed: ' + name)
    fs.mkdirSync(dir, { recursive: true })
    const entry = { name, repo: model, lib, initiallyPresent: fs.existsSync(path.join(dir, 'hub')), attempts: [] }
    report.models.push(entry)
    for (const source of ['modelscope', 'hf']) {
      const log = path.join(root, name + '-' + source + '-download.log')
      const env = { ...process.env, PYTHONPATH: lib, HF_HOME: dir, HF_HUB_OFFLINE: '0',
        HF_HUB_CACHE: path.join(dir, 'hub'), HUGGINGFACE_HUB_CACHE: path.join(dir, 'hub'),
        TRANSFORMERS_CACHE: path.join(dir, 'hub'), HF_ASSETS_CACHE: path.join(dir, 'assets'),
        MODELSCOPE_CACHE: path.join(dir, 'modelscope') }
      if (source === 'hf') Object.assign(env, { HF_ENDPOINT: 'https://hf-mirror.com', HF_HUB_DISABLE_XET: '1' })
      const result = await run([script, '--source', source, '--repo', model, '--hf-home', dir], env, log)
      entry.attempts.push({ source, log, ...result })
      if (result.code === 0 && !result.timedOut) {
        saveInventory(name + '-models', dir)
        const state = checkInventory(name + '-models', dir)
        if (!state.installed) throw new Error('Product inventory rejected downloaded model: ' + name)
        entry.inventory = JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8'))
        entry.installed = true
        break
      }
    }
    if (!entry.installed) throw new Error('Both product model sources failed: ' + name)
  }
  report.passed = true
}
main().catch(error => { report.passed = false; report.error = String(error); process.exitCode = 1 })
  .finally(() => fs.writeFileSync(path.join(root, 'model-prepare.json'), JSON.stringify(report, null, 2)))
