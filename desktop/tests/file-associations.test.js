// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const config = require('../package.json').build
const script = fs.readFileSync(path.join(__dirname, '../build/win/file-associations.nsh'), 'utf8')
const installer = fs.readFileSync(path.join(__dirname, '../build/installer.nsh'), 'utf8')

test('mac and Windows register the same supported document/image candidates without default takeover', () => {
  const mac = config.mac.fileAssociations
  const windows = [...script.matchAll(/!insertmacro AwdFileType "(\w+)"/g)].map(match => match[1])
  assert.deepEqual(mac.flatMap(x => x.ext).sort(), windows.sort())
  assert.ok(windows.includes('docx') && windows.includes('pdf'))
  assert.ok(mac.every(x => x.rank === 'Alternate'))
  assert.equal(mac.find(x => x.ext.includes('pdf')).role, 'Viewer')
  assert.equal(mac.find(x => x.ext.includes('docx')).role, 'Editor')
  // electron-builder 24's NSIS FileAssociation helper rewrites extension defaults.
  assert.equal(config.fileAssociations, undefined)
  assert.equal(config.win.fileAssociations, undefined)
  assert.match(installer, /!macro customInstall\s+!insertmacro AwdRegisterFileAssociations/)
  assert.match(installer, /!macro customUnInstall\s+!insertmacro AwdUnregisterFileAssociations/)
})

// Execute registry operations after expanding this small NSIS include's macros. This verifies
// uninstall preserves other handlers and user defaults; it does not replace a Windows smoke test.
function registryHarness() {
  const variables = { PRODUCT_FILENAME: 'AI WorkDeck' }
  for (const [, name, value] of script.matchAll(/^!define (\w+) "([^"]*)"/gm)) variables[name] = value
  const macros = new Map([...script.matchAll(/^!macro (\w+)([^\n]*)\n([\s\S]*?)^!macroend/gm)]
    .map(([, name, parameters, body]) => [name, { parameters: parameters.trim().split(/\s+/).filter(Boolean), body }]))
  const registry = new Map()
  const keyValue = (key, name) => `${key}|${name}`
  const write = (key, name, value) => registry.set(keyValue(key, name), value)
  const read = (key, name) => registry.get(keyValue(key, name))
  function execute(name, args = []) {
    const macro = macros.get(name)
    assert.ok(macro, name)
    const values = { ...variables, ...Object.fromEntries(macro.parameters.map((key, i) => [key, args[i]])) }
    const expanded = macro.body.replace(/\$\{(\w+)\}/g, (_, key) => { assert.ok(key in values, key); return values[key] })
    let enabled = true
    for (const line of expanded.split('\n').map(x => x.trim()).filter(Boolean)) {
      const branch = line.match(/^!if "([^"]*)" == "([^"]*)"$/)
      if (branch) { enabled = branch[1] === branch[2]; continue }
      if (line === '!else') { enabled = !enabled; continue }
      if (line === '!endif') { enabled = true; continue }
      if (!enabled || line.startsWith(';') || line.startsWith('System::Call')) continue
      const nested = line.match(/^!insertmacro (\w+)(.*)$/)
      if (nested) { execute(nested[1], [...nested[2].matchAll(/"([^"]*)"/g)].map(x => x[1])); continue }
      const put = line.match(/^WriteRegStr HKCU "([^"]*)" "([^"]*)" (.*)$/)
      if (put) { write(put[1], put[2], put[3].slice(1, -1)); continue }
      const remove = line.match(/^DeleteRegValue HKCU "([^"]*)" "([^"]*)"$/)
      if (remove) { registry.delete(keyValue(remove[1], remove[2])); continue }
      const tree = line.match(/^DeleteRegKey (\/ifempty )?HKCU "([^"]*)"$/)
      if (tree) {
        if (!tree[1]) for (const key of registry.keys()) {
          if (key.startsWith(tree[2] + '|') || key.startsWith(tree[2] + '\\')) registry.delete(key)
        }
        continue
      }
      assert.fail(`Unrecognized NSIS operation: ${line}`)
    }
  }
  return { registry, execute, write, read }
}

test('install, reinstall and uninstall preserve the previous defaults and other Open With handlers', () => {
  const h = registryHarness()
  h.write('Software\\Classes\\.docx', '', 'Word.Document.12')
  h.write('Software\\Classes\\.pdf\\OpenWithProgids', 'AcroExch.Document', '')
  h.write('Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice', 'ProgId', 'MSEdgePDF')
  h.write('Software\\RegisteredApplications', 'Other', 'Software\\Other\\Capabilities')
  const previous = new Map(h.registry)
  h.execute('AwdRegisterFileAssociations')
  h.execute('AwdRegisterFileAssociations')
  for (const [key, value] of previous) assert.equal(h.registry.get(key), value)
  assert.equal(h.read('Software\\Classes\\.docx\\OpenWithProgids', 'com.aiworkdeck.desktop.Document'), '')
  assert.equal(h.read('Software\\AI WorkDeck\\Capabilities\\FileAssociations', '.pdf'), 'com.aiworkdeck.desktop.Document')
  assert.equal(h.read('Software\\Classes\\com.aiworkdeck.desktop.Document\\shell\\open\\command', ''), String.raw`$\"$INSTDIR\AI WorkDeck.exe$\" $\"%1$\"`)
  h.execute('AwdUnregisterFileAssociations')
  assert.deepEqual(h.registry, previous)
})
