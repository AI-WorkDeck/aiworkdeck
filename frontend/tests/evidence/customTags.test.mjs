// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as tags from '../../src/utils/evidenceTags.js'
import { EVIDENCE_METHODS } from '../../src/utils/evidenceLocator.js'
import zh from '../../src/locales/zh-CN/workbench.js'
const t = key => key.split('.').slice(1).reduce((v, k) => v?.[k], zh) || key

test('editable labels preserve builtin keys and reject duplicates/empty/oversize/control labels', () => {
  assert.deepEqual(tags.evidenceTagsFromLabels(['书面审查', ' 原件已核对 '], t), ['written_review', '原件已核对'])
  for (const values of [[''], ['a', ' a '], ['a\nb'], ['x'.repeat(33)], Array.from({length: 13}, (_,i) => String(i))]) {
    assert.throws(() => tags.evidenceTagsFromLabels(values, t))
  }
  assert.equal(tags.evidenceTagLabel('written_review', t), '书面审查')
  assert.equal(tags.evidenceTagLabel('<自定义标签>', t), '<自定义标签>')
  for (const name of tags.EVIDENCE_TAG_PRESETS) assert.equal(tags.evidenceTagPreset(name, t).length, 5)
})

test('favorites persist per user, allow an empty list, and leave existing target values intact', () => {
  const data = new Map(); let user = { id: 7 }; const events = []
  globalThis.uni = { getStorageSync: key => key === 'checkba_user' ? user : data.get(key), setStorageSync: (k,v) => data.set(k,v), $emit: name => events.push(name) }
  assert.deepEqual(tags.loadEvidenceTags(), EVIDENCE_METHODS)
  tags.saveEvidenceTags(['自定义核对'])
  assert.deepEqual(tags.loadEvidenceTags(), ['自定义核对'])
  user = { id: 8 }; assert.deepEqual(tags.loadEvidenceTags(), EVIDENCE_METHODS)
  tags.saveEvidenceTags([]); assert.deepEqual(tags.loadEvidenceTags(), [])
  user = { id: 7 }; assert.deepEqual(tags.loadEvidenceTags(), ['自定义核对'])
  assert.equal(tags.evidenceTagLabel('旧标签', t), '旧标签')
  assert.equal(events.length, 2)
  uni.setStorageSync = () => { throw Error('quota') }
  assert.throws(() => tags.saveEvidenceTags(['新标签']), /quota/)
  delete globalThis.uni
})

const src = readFileSync(new URL('../../src/pages/project-overview/evidenceLinkActions.js', import.meta.url), 'utf8')
  .replace(/^import [\s\S]*?from .*$/gm, '').replace(/^export \{[^}]*\}$/gm, '').replace(/^export const/gm, 'const')
function actions(update, emitted) {
  return new Function('updateEvidenceTarget', 'uni', 'evidenceTagLabel', src + '\nreturn { evidenceLinkData, evidenceLinkMethods }')(update, { $emit: (...args) => emitted.push(args) }, tags.evidenceTagLabel)
}

test('failed target save retains selected tag and shows an inline retryable error', async () => {
  const emitted = []; const mod = actions(async () => { throw Error('合成保存失败') }, emitted)
  const vm = { ...mod.evidenceLinkData(), ...mod.evidenceLinkMethods, projectId: 1, $t: t }
  vm.showEvidenceMethodBar({side:'left', fileName:'合成材料', targetId:7, linkKey:'EVID_A', docFileId:10})
  await vm.onEvidenceMethodChange({targetId:7,method:'原件核对'})
  assert.equal(vm.evidenceMethodBar.method, 'written_review')
  assert.equal(vm.evidenceMethodBar.errorText, '合成保存失败')
  assert.equal(vm.evidenceMethodBar.saving, false)
  assert.deepEqual(emitted, [])
})

test('pending target save cannot rewrite a newer receipt or notify the wrong document', async () => {
  let resolve; let count = 0; const emitted = []
  const mod = actions(() => { count++; return new Promise(r => { resolve = r }) }, emitted)
  const vm = { ...mod.evidenceLinkData(), ...mod.evidenceLinkMethods, projectId: 1, $t: t }
  vm.showEvidenceMethodBar({side:'left', fileName:'A', targetId:7, linkKey:'EVID_A', docFileId:10})
  const pending = vm.onEvidenceMethodChange({targetId:7,method:'原件核对'})
  await vm.onEvidenceMethodChange({targetId:7,method:'另一个标签'})
  assert.equal(count, 1)
  vm.showEvidenceMethodBar({side:'right', fileName:'B', targetId:8, linkKey:'EVID_B', docFileId:11})
  resolve(); await pending
  assert.equal(vm.evidenceMethodBar.method, 'written_review')
  assert.deepEqual(emitted, [['awd:evidence-changed', {docFileId:10,linkKey:'EVID_A'}]])
  assert.equal(vm.evidenceMethodLabel('原件核对'), '原件核对')
})
