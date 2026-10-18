// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Backport electron-builder PR #9769 without upgrading the packaging toolchain.
// https://github.com/electron-userland/electron-builder/pull/9769
// Fixed upstream commit: a356198ec7c54c7795659342bff36d9a5162cd93
// Source: packages/app-builder-lib/templates/nsis/multiUser.nsh
// The upstream template fragments below retain their MIT license:
/*
The MIT License (MIT)
Copyright (c) 2015 Loopline Systems

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { patchNsisSource, patchNsisFile } = require('../scripts/patch-nsis-known-folder')

const legacy = [
  "  !macro setInstallModePerUser",
  "    StrCpy $installMode CurrentUser",
  "    SetShellVarContext current",
  "",
  "    # сhecks registry for previous installation path",
  "    ReadRegStr $perUserInstallationFolder HKCU \"${INSTALL_REGISTRY_KEY}\" InstallLocation",
  "    ${if} $perUserInstallationFolder != \"\"",
  "      StrCpy $INSTDIR $perUserInstallationFolder",
  "    ${else}",
  "      StrCpy $0 \"$LocalAppData\\Programs\"",
  "      System::Store S",
  "      # Win7 has a per-user programfiles known folder and this can be a non-default location",
  "      System::Call 'SHELL32::SHGetKnownFolderPath(g \"${FOLDERID_UserProgramFiles}\", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'",
  "      ${If} $1 == 0",
  "        System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'",
  "        StrCpy $0 $1",
  "        System::Call 'OLE32::CoTaskMemFree(p r2)'",
  "      ${endif}",
  "      System::Store L",
  "      StrCpy $INSTDIR \"$0\\${APP_FILENAME}\"",
  "    ${endif}",
  "",
  "    # allow /D switch to override installation path https://github.com/electron-userland/electron-builder/issues/1551",
  "    ${StdUtils.GetParameter} $R0 \"D\" \"\"",
  "    ${If} $R0 != \"\"",
  "      StrCpy $INSTDIR $R0",
  "    ${endif}",
  "",
  "  !macroend"
].join('\n')

test('backport keeps directory and /D behavior while replacing only the unsafe copy', () => {
  const result = patchNsisSource('before\n' + legacy + '\nafter\n')
  assert.ok(result.startsWith('before\n' + legacy.slice(0, legacy.indexOf('      System::Store S'))))
  assert.ok(result.endsWith(legacy.slice(legacy.indexOf('      StrCpy $INSTDIR "$0')) + '\nafter\n'))
  assert.ok(result.includes("System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'"))
  assert.ok(result.includes('Push $1\n      Push $2'))
  assert.ok(result.includes('StrCpy $2 0'))
  assert.ok(result.includes('${If} $2 != 0\n        System::Call'))
  assert.ok(result.includes('Pop $2\n      Pop $1'))
  assert.ok(!result.includes('System::Store'))
  assert.ok(!result.includes('&w${NSIS_MAX_STRLEN}'))
})

test('patch is idempotent and preserves LF and CRLF', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = legacy.replace(/\n/g, newline)
    const patched = patchNsisSource(source)
    assert.equal(patchNsisSource(patched), patched)
    if (newline === '\r\n') assert.equal(patched.replace(/\r\n/g, '').includes('\n'), false)
  }
})

test('unknown, partial, duplicate or altered fixed macros fail closed without writing', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-nsis-patch-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const target = path.join(dir, 'multiUser.nsh')
  const fixed = patchNsisSource(legacy)
  for (const source of ['', legacy + '\n' + legacy, legacy.replace('System::Store S', 'Push $1'),
    legacy.replace('"D"', '"different-option"'), fixed.replace('lstrcpynW', 'lstrcpyW')]) {
    fs.writeFileSync(target, source)
    assert.throws(() => patchNsisFile(target), /Expected exactly one|Unknown/)
    assert.equal(fs.readFileSync(target, 'utf8'), source)
  }
  assert.throws(() => patchNsisFile(path.join(dir, 'missing.nsh')), /ENOENT/)
})

test('file entry patches once and detects its completed result', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-nsis-patch-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const target = path.join(dir, 'multiUser.nsh')
  fs.writeFileSync(target, legacy)
  assert.equal(patchNsisFile(target), true)
  assert.equal(patchNsisFile(target), false)
  assert.equal(fs.readFileSync(target, 'utf8'), patchNsisSource(legacy))
})
