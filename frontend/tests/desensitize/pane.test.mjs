// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const sfc = readFileSync(new URL('../../src/components/DesensitizePane.vue', import.meta.url), 'utf8')
const script = sfc.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*$/m, '').replace('export default', 'const component =') + '\ncomponent'
function pane(api = {}) {
  const events = []
  const component = vm.runInNewContext(script, { getSensitiveRecovery: async () => ({ recoveryKit: '', name: '' }), ...api, URL, Blob, setTimeout })
  const state = { ...component.data(), projectId: 1, prepareFile: async () => false, $t: x => x, $emit: (...args) => events.push(args) }
  for (const [key, fn] of Object.entries(component.methods)) state[key] = fn.bind(state)
  for (const [key, fn] of Object.entries(component.computed)) Object.defineProperty(state, key, { get: fn.bind(state) })
  return { state, component, events }
}

test('preview sends rules and file id without the recovery password or map', async () => {
  let payload
  const { state } = pane({ previewSensitiveFile: async value => { payload = value; return { text: '[[公司1_example]]', counts: { COMPANY: 1 } } } })
  state.selectFile({ id: 1, name: 'sample.docx', filePath: 'sample.docx' })
  state.selectedStrategies = ['COMPANY']; state.customTerms = '星河\n A+B '; state.password = 'secret-password'; state.recoveryKit = 'secret-map'
  await state.handlePreview()
  assert.equal(payload.mode, 'TOKEN')
  assert.deepEqual(Array.from(payload.customTerms), ['星河', 'A+B'])
  assert.equal(payload.password, undefined)
  assert.equal(payload.recoveryKit, undefined)
  assert.equal(state.totalMatches, 1)
})

test('new generation opens the project result without any download and clears preview tokens/password', async () => {
  const { state, events } = pane({ desensitizeFile: async () => ({ file: { id: 4 }, recoveryKit: 'AWD-RECOVERY-1:encrypted', counts: { PHONE: 2 } }) })
  state.fileId = 1; state.fileName = 'sample.txt'; state.preview = { text: 'preview' }; state.password = 'secret-password'
  let downloads = 0; state.downloadKit = () => { downloads++ }
  await state.handleGenerate()
  assert.equal(downloads, 0)
  assert.equal(state.exportedKit, 'AWD-RECOVERY-1:encrypted')
  assert.equal(state.preview, null); assert.equal(state.password, '')
  assert.equal(events[0][0], 'open-file'); assert.equal(events[0][1].id, 4)
})

test('zero-match generation never offers a stale map from a previous document', async () => {
  const { state } = pane({ desensitizeFile: async () => ({ file: { id: 5 }, recoveryKit: '', counts: {} }) })
  state.fileId = 1; state.preview = {}; state.exportedKit = 'old kit'
  await state.handleGenerate()
  assert.equal(state.exportedKit, '')
})

test('restore targets selected file, reports errors and never opens a failed result', async () => {
  let payload
  const { state, events } = pane({ restoreSensitiveFile: async value => { payload = value; throw new Error('wrong password') } })
  state.fileId = 6; state.recoveryKit = 'encrypted'; state.password = 'secret-password'
  await state.handleRestore()
  assert.equal(payload.fileId, 6); assert.equal(payload.recoveryKit, 'encrypted')
  assert.equal(state.error, 'wrong password'); assert.equal(state.processing, false)
  assert.equal(events.length, 0)
})

test('PDF selection uses irreversible mode; project change clears sensitive state', () => {
  const { state, component } = pane()
  state.selectFile({ id: 1, filePath: 'doc.pdf', name: 'doc.PDF' })
  assert.equal(state.effectiveMode, 'MASK')
  state.password = 'secret-password'; state.recoveryKit = 'map'; state.exportedKit = 'export'
  state.customTerms = 'private'; state.excludedTerms = 'also private'
  state.lastRedaction = { kit: 'encrypted', file: { id: 9 } }
  component.watch.projectId.call(state)
  assert.equal(state.fileId, null); assert.equal(state.password, '')
  assert.equal(state.recoveryKit, ''); assert.equal(state.exportedKit, '')
  assert.equal(state.customTerms, ''); assert.equal(state.excludedTerms, '')
  assert.equal(state.lastRedaction, null)
})


test('generating waits for editor save, and a save failure never calls the redaction API', async () => {
  let calls = 0
  const { state } = pane({ desensitizeFile: async () => { calls++; return {} } })
  state.fileId = 1; state.preview = {}; state.password = 'long-password'
  state.prepareFile = async () => { throw new Error('save failed') }
  await state.handleGenerate()
  assert.equal(calls, 0); assert.equal(state.error, 'save failed'); assert.equal(state.processing, false)
})

test('explicit restore-result action selects the generated file and reuses its encrypted kit', async () => {
  const { state } = pane({ desensitizeFile: async () => ({ file: { id: 4, name: 'redacted.docx', filePath: 'redacted.docx' }, recoveryKit: 'AWD-RECOVERY-1:encrypted', counts: {} }) })
  state.fileId = 1; state.fileName = 'original.docx'; state.preview = {}; state.downloadKit = () => {}
  await state.handleGenerate()
  state.restoreLastResult()
  assert.equal(state.operation, 'restore'); assert.equal(state.fileId, 4)
  assert.equal(state.recoveryKit, 'AWD-RECOVERY-1:encrypted')
  assert.equal(state.password, '')
})

test('preview and restore also wait for the target file to be saved', async () => {
  const order = []
  const { state } = pane({
    previewSensitiveFile: async () => { order.push('preview'); return {} },
    restoreSensitiveFile: async () => { order.push('restore'); return { file: { id: 9 } } },
  })
  state.fileId = 1; state.recoveryKit = 'encrypted'
  state.prepareFile = async id => { assert.equal(id, 1); order.push('save') }
  await state.handlePreview(); await state.handleRestore()
  assert.deepEqual(order, ['save', 'preview', 'save', 'restore'])
})

test('changes saved after preview require a fresh preview before generation', async () => {
  let calls = 0
  const { state } = pane({ desensitizeFile: async () => { calls++; return {} } })
  state.fileId = 1; state.preview = {}; state.prepareFile = async () => true
  await state.handleGenerate()
  assert.equal(calls, 0); assert.equal(state.preview, null)
})

test('switching to restore automatically associates the selected generated document', async () => {
  const { state } = pane()
  state.lastRedaction = { file: { id: 4 }, kit: 'encrypted' }
  state.selectFile({ id: 4, name: 'redacted.txt', filePath: 'redacted.txt' })
  state.chooseOperation('restore')
  assert.equal(state.recoveryKit, 'encrypted')
  state.password = '1'
  assert.equal(state.restoreRequirement, '')
})

test('reopened pane loads project recovery materials; late results cannot cross file selections', async () => {
  let resolveFirst
  const { state } = pane({ getSensitiveRecovery: ({ fileId }) => fileId === 1
    ? new Promise(resolve => { resolveFirst = resolve }) : Promise.resolve({ recoveryKit: 'second', name: 'second.awd-recovery' }) })
  state.operation = 'restore'
  state.selectFile({ id: 1, name: 'first.txt', filePath: 'first.txt' })
  state.selectFile({ id: 2, name: 'second.txt', filePath: 'second.txt' })
  await new Promise(resolve => setTimeout(resolve, 0))
  resolveFirst({ recoveryKit: 'first', name: 'first.awd-recovery' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(state.recoveryKit, 'second')
  assert.equal(state.loadingKit, false)
})

test('restore uses only the selected document to load recovery data, without a material picker', async () => {
  const calls = []
  const { state } = pane({ getSensitiveRecovery: async value => { calls.push(value); return { recoveryKit: 'linked' } } })
  state.fileId = 42; state.fileName = 'redacted.docx'
  await state.loadRecovery()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ fileId: 42 }])
  assert.equal(state.recoveryKit, 'linked')
  assert.equal(state.importKit, undefined)
})

test('missing recovery directs the user to select an original and clears the tokenized target even on cancel', async () => {
  const { state, events } = pane()
  state.operation = 'restore'; state.fileId = 42; state.fileName = 'redacted.docx'; state.filePath = 'redacted.docx'
  state.password = 'secret'; state.lastRedaction = { file: { id: 42 }, kit: 'old' }
  state.$emit = (...event) => { events.push(event); event[2]?.() }
  assert.equal(state.restoreRequirement, 'panels.deRecoveryMissing')
  state.selectOriginalForRedaction()
  assert.equal(state.operation, 'redact')
  assert.equal(state.fileId, null); assert.equal(state.fileName, ''); assert.equal(state.filePath, '')
  assert.equal(state.password, ''); assert.equal(state.lastRedaction, null)
  assert.equal(events[0][0], 'request-file-select')
  events[0][1](null)
  assert.equal(state.fileId, null)
  events[0][1]({ id: 3, name: 'original.docx', filePath: 'original.docx' })
  assert.equal(state.fileId, 3)
})

test('late recovery response cannot repopulate data after returning to select an original', async () => {
  let resolveRecovery
  const { state } = pane({ getSensitiveRecovery: () => new Promise(resolve => { resolveRecovery = resolve }) })
  state.operation = 'restore'; state.fileId = 42; state.fileName = 'redacted.docx'
  const pending = state.loadRecovery()
  state.selectOriginalForRedaction()
  resolveRecovery({ recoveryKit: 'stale' })
  await pending
  assert.equal(state.fileId, null); assert.equal(state.recoveryKit, ''); assert.equal(state.loadingKit, false)
})

// Render the actual template: collapsed settings must retain values, and creation
// must stay behind the existing preview/password gates.
const VueRuntime = await import('vue')
const SsrRuntime = await import('vue/server-renderer')
const { parse, compileTemplate } = await import('vue/compiler-sfc')
const { descriptor } = parse(sfc)
const compiled = compileTemplate({ source: descriptor.template.content, filename: 'DesensitizePane.vue', id: 'desensitize-pane', ssr: true, ssrCssVars: [], compilerOptions: { isCustomElement: tag => ['view', 'text', 'scroll-view'].includes(tag) } })
assert.equal(compiled.errors.length, 0)
const renderBody = compiled.code.replace(/^import \{([^}]+)\} from "(vue(?:\/server-renderer)?)"$/gm, (_, names, source) => `const {${names.replace(/\bas\b/g, ':')}} = ${source === 'vue' ? '__vue' : '__ssr'}`)
  .replace('export function ssrRender', 'function ssrRender')
const ssrRender = new Function('__vue', '__ssr', renderBody + '\nreturn ssrRender')(VueRuntime, SsrRuntime)
async function renderPane(overrides = {}) {
  const { component } = pane()
  const app = VueRuntime.createSSRApp({ ...component, ssrRender, data: () => ({ ...component.data(), ...overrides }) }, { projectId: 1, prepareFile: async () => false })
  app.config.globalProperties.$t = key => key
  return SsrRuntime.renderToString(app)
}

test('initial sidebar exposes preview with collapsed settings and no premature password form', async () => {
  const html = await renderPane({ fileId: 1, selectedStrategies: ['PHONE'] })
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /<view(?=[^>]*class="settings-content")(?=[^>]*style="display:none)[^>]*>/)
  assert.match(html, /panels.dePreview/)
  assert.doesNotMatch(html, /password-input/)
  assert.doesNotMatch(html, />panels.deGenerate</)
})

test('review reveals password and disables generation until it is nonempty', async () => {
  const html = await renderPane({ fileId: 1, preview: { text: 'review this' } })
  assert.match(html, /password-input/)
  assert.match(html, /<button[^>]*disabled[^>]*>panels.deGenerate<\/button>/)
  const ready = await renderPane({ fileId: 1, preview: { text: 'review this' }, password: '1' })
  assert.match(ready, /<button(?![^>]*disabled)[^>]*>panels.deGenerate<\/button>/)
})

test('settings expansion retains selected rules and custom terms; processing exposes status', async () => {
  const html = await renderPane({ settingsOpen: true, processing: true, customTerms: 'retained term', selectedStrategies: ['PHONE'] })
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /retained term/)
  assert.match(html, /role="status"/)
  assert.doesNotMatch(html, /<view(?=[^>]*class="settings-content")(?=[^>]*style="display:none)[^>]*>/)
})


test('initial pane omits repeated instructions and keeps token guidance at the review step', async () => {
  const initial = await renderPane()
  assert.doesNotMatch(initial, /panels.deLocalNotice|panels.deStepSelect|panels.deStepReview|panels.deStepCreate/)
  assert.doesNotMatch(initial, /class="help-text">panels.deTokenNotice/)
  const reviewing = await renderPane({ fileId: 1, preview: { text: 'synthetic preview' } })
  assert.match(reviewing, /class="help-text">panels.deTokenNotice/)
  assert.match(reviewing, /panels.deReviewNotice/)
})

test('irreversible modes keep their limitations visible before preview', async () => {
  const masking = await renderPane({ mode: 'MASK' })
  assert.match(masking, /class="help-text">panels.deMaskNotice/)
  const pdf = await renderPane({ fileName: 'synthetic.pdf' })
  assert.match(pdf, /class="help-text">panels.dePdfNotice/)
})

test('choosing an operation keeps the file selected first, including after another generation', () => {
  const { state } = pane()
  state.lastRedaction = {
    source: { id: 1, name: 'original.docx', filePath: 'original.docx' },
    file: { id: 4, name: 'redacted.docx', filePath: 'redacted.docx' }, kit: 'old-map',
  }
  state.selectFile({ id: 8, name: 'selected.docx', filePath: 'selected.docx' })
  state.preview = {}; state.password = 'previous-password'
  state.chooseOperation('restore')
  assert.equal(state.fileId, 8)
  assert.equal(state.fileName, 'selected.docx')
  assert.equal(state.recoveryKit, '')
  assert.equal(state.preview, null)
  assert.equal(state.password, '')
  state.chooseOperation('redact')
  assert.equal(state.fileId, 8)
  assert.equal(state.filePath, 'selected.docx')
})

test('processing blocks operation changes and the explicit restore-result shortcut', () => {
  const { state } = pane()
  state.fileId = 8; state.processing = true
  state.lastRedaction = { file: { id: 4, name: 'redacted.docx', filePath: 'redacted.docx' }, kit: 'old-map' }
  state.chooseOperation('restore'); state.restoreLastResult()
  assert.equal(state.operation, 'redact')
  assert.equal(state.fileId, 8)
  assert.equal(state.recoveryKit, '')
})

test('rendered redact workflow follows file, action, terms, types, replacement and preview order', async () => {
  const html = await renderPane()
  const keys = ['deSectionFileSelect', 'deOperationTitle', 'deRedactTab', 'deCustomWordsTitle',
    'deStrategiesTitle', 'deModeTitle', 'dePreview']
  let previous = -1
  for (const key of keys) {
    const position = html.indexOf('panels.' + key)
    assert.ok(position > previous, `${key} must follow the preceding step`)
    previous = position
  }
  assert.match(html, /aria-pressed="true"/)
  assert.doesNotMatch(html, /panels.deStepReview/)
})

test('restore workflow keeps file and operation first, then shows recovery controls only', async () => {
  const html = await renderPane({ operation: 'restore', fileId: 8, fileName: 'selected.docx' })
  assert.ok(html.indexOf('panels.deRestoreDocument') < html.indexOf('panels.deOperationTitle'))
  assert.ok(html.indexOf('panels.deOperationTitle') < html.indexOf('panels.dePassword'))
  assert.doesNotMatch(html, /panels.deCustomWordsTitle|panels.deStrategiesTitle|panels.deModeTitle|panels.deImportKit/)
  assert.match(html, /panels.deRecoveryMissing/)
  assert.match(html, /panels.deSelectOriginal/)
  assert.match(html, /<button[^>]*disabled[^>]*>panels.deRestoreGenerate<\/button>/)
})

test('automatically matched recovery shows a simple status and needs only a password', async () => {
  const html = await renderPane({ operation: 'restore', fileId: 8, fileName: 'selected.docx', recoveryKit: 'linked', password: 'secret' })
  assert.match(html, /panels.deCurrentKit/)
  assert.doesNotMatch(html, /panels.deImportKit|panels.deSelectOriginal|panels.deRecoveryMissing/)
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*>panels.deRestoreGenerate<\/button>/)
})

test('loading recovery does not prematurely offer re-redaction', async () => {
  const html = await renderPane({ operation: 'restore', fileId: 8, fileName: 'selected.docx', loadingKit: true })
  assert.doesNotMatch(html, /panels.deSelectOriginal|panels.deRecoveryMissing/)
  assert.match(html, /<button[^>]*disabled[^>]*>panels.deRestoreGenerate<\/button>/)
})

test('load failure offers retry without claiming missing materials or enabling restoration', async () => {
  const html = await renderPane({ operation: 'restore', fileId: 8, fileName: 'selected.docx', error: 'network unavailable' })
  assert.match(html, /network unavailable/)
  assert.match(html, /common.retry/)
  assert.doesNotMatch(html, /panels.deSelectOriginal|panels.deRecoveryMissing/)
  assert.match(html, /<button[^>]*disabled[^>]*>panels.deRestoreGenerate<\/button>/)
  let calls = 0
  const { state } = pane({ getSensitiveRecovery: async () => { if (++calls === 1) throw new Error('network unavailable'); return { recoveryKit: 'linked' } } })
  state.operation = 'restore'; state.fileId = 8; state.fileName = 'selected.docx'
  await state.loadRecovery()
  assert.equal(state.error, 'network unavailable'); assert.equal(state.restoreRequirement, '')
  const pending = state.loadRecovery()
  assert.equal(state.error, ''); assert.equal(state.loadingKit, true)
  await pending
  assert.equal(state.recoveryKit, 'linked'); assert.equal(state.loadingKit, false)
  assert.equal(state.restoreRequirement, 'panels.dePasswordHint')
})

test('PDF restoration never invites recovery lookup or selecting an original', async () => {
  const html = await renderPane({ operation: 'restore', fileId: 8, fileName: 'selected.PDF' })
  assert.match(html, /panels.dePdfNotice/)
  assert.doesNotMatch(html, /panels.deRestoreNotice|panels.deRecoveryMissing|panels.deSelectOriginal|common.retry/)
  let calls = 0
  const { state } = pane({ getSensitiveRecovery: async () => { calls++; return {} } })
  state.fileId = 8; state.fileName = 'selected.PDF'
  await state.loadRecovery()
  assert.equal(calls, 0)
})

test('automatic recovery copy is explicitly translated in all 20 locales', async () => {
  const { readdirSync } = await import('node:fs')
  const root = new URL('../../src/locales/', import.meta.url)
  const locales = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory())
  assert.equal(locales.length, 20)
  for (const { name } of locales) {
    const source = readFileSync(new URL(`${name}/panels.js`, root), 'utf8')
    const messages = vm.runInNewContext(source.replace('export default', 'const messages =') + '\nmessages')
    for (const key of ['deCurrentKit', 'deRestoreNotice', 'deRecoveryMissing', 'deSelectOriginal']) {
      assert.ok(typeof messages[key] === 'string' && messages[key].trim(), `${name} must explicitly translate ${key}`)
    }
  }
})
