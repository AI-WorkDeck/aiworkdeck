// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('fs')
const path = require('path')

// Structure checks are local readiness evidence, not a cryptographic claim about model weights.
// Inventory sizes are captured only after the downloader succeeds, then checked without reading GBs.
const MARKER = '.aiworkdeck-complete'
const HF = {
  'asr-models': ['Systran/faster-whisper-medium', ['config.json', 'tokenizer.json', 'vocabulary.json', 'model.bin']],
  'kokoro-models': ['hexgrad/Kokoro-82M-v1.1-zh', ['config.json', 'kokoro-v1_1-zh.pth',
    'voices/zf_001.pt', 'voices/zm_010.pt', 'voices/af_maple.pt', 'voices/bf_vale.pt']],
}
// MinerU 3.4.3 models_download.download_pipeline_models / ModelPath (requirements.lock).
const MINERU_REQUIRED = ['models/Layout/PP-DocLayoutV2', 'models/MFR/unimernet_hf_small_2503',
  'models/MFR/pp_formulanet_plus_m', 'models/OCR/paddleocr_torch',
  'models/TabRec/SlanetPlus/slanet-plus.onnx', 'models/TabRec/UnetStructure/unet.onnx',
  'models/TabCls/paddle_table_cls/PP-LCNet_x1_0_table_cls.onnx']

function inside(root, file) {
  const rel = path.relative(fs.realpathSync(root), fs.realpathSync(file))
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('model path outside component directory')
}
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }

function inventory(id, dir) {
  let root, required, revision = null
  if (HF[id]) {
    const [repo, files] = HF[id]
    const hub = path.join(dir, 'hub', 'models--' + repo.replace('/', '--'))
    revision = fs.readFileSync(path.join(hub, 'refs', 'main'), 'utf8').trim()
    if (!/^[a-f0-9]{40,64}$/i.test(revision)) throw new Error('missing or invalid model revision')
    root = path.join(hub, 'snapshots', revision)
    required = files
    json(path.join(root, 'config.json'))
    if (id === 'asr-models') { json(path.join(root, 'tokenizer.json')); json(path.join(root, 'vocabulary.json')) }
  } else if (id === 'mineru-models') {
    const config = json(path.join(dir, 'mineru.json'))
    root = config['models-dir']?.pipeline
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('missing MinerU pipeline configuration')
    required = MINERU_REQUIRED
  } else throw new Error('unknown model component')
  inside(dir, root)
  const files = []
  const visit = (file) => {
    inside(dir, file)
    const st = fs.statSync(file)
    if (st.isDirectory()) {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('model directory symlink is not supported')
      const before = files.length
      for (const name of fs.readdirSync(file)) visit(path.join(file, name))
      if (files.length === before) throw new Error('empty model directory')
    } else {
      if (!st.isFile() || st.size <= 0 || /\.(incomplete|tmp)$/.test(file)) throw new Error('incomplete model file')
      files.push({ path: path.relative(dir, file).split(path.sep).join('/'), size: st.size })
    }
  }
  for (const name of required) visit(path.join(root, name))
  if (id === 'mineru-models') visit(path.join(dir, 'mineru.json'))
  return { schema: 1, id, revision, root: path.relative(dir, root).split(path.sep).join('/'), files }
}

function checkInventory(id, dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, MARKER), 'utf8')
    const current = inventory(id, dir)
    let saved
    try { saved = JSON.parse(raw) } catch (_) { /* legacy timestamp */ }
    if (!saved || saved.schema !== 1) {
      if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(raw.trim())) return { installed: false, invalid: true, reason: 'legacy' }
      // Upgrade known timestamp markers after lightweight structure checks, without network or hashing.
      // This is a structure/size baseline, not proof of upstream byte integrity.
      try { saveInventory(id, dir) } catch (_) { /* Read-only installs remain usable if structure passed. */ }
      return { installed: true, validation: 'structure-and-size' }
    }
    if (saved.id !== id || saved.revision !== current.revision || saved.root !== current.root
        || !Array.isArray(saved.files) || saved.files.length !== current.files.length) throw new Error('model inventory changed')
    const lengths = new Map(saved.files.map((f) => [f.path, f.size]))
    if (current.files.some((f) => lengths.get(f.path) !== f.size)) throw new Error('model file missing or truncated')
    return { installed: true }
  } catch (_) {
    return { installed: false, invalid: fs.existsSync(path.join(dir, MARKER)) }
  }
}

function saveInventory(id, dir) {
  const value = inventory(id, dir)
  const tmp = path.join(dir, MARKER + '.tmp')
  fs.writeFileSync(tmp, JSON.stringify(value))
  fs.renameSync(tmp, path.join(dir, MARKER))
}

module.exports = { MARKER, inventory, checkInventory, saveInventory, MINERU_REQUIRED }
