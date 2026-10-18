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
const fs = require('node:fs')
const path = require('node:path')

const LEGACY_MACRO = [
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

const UNSAFE_COPY = [
  "      System::Store S",
  "      # Win7 has a per-user programfiles known folder and this can be a non-default location",
  "      System::Call 'SHELL32::SHGetKnownFolderPath(g \"${FOLDERID_UserProgramFiles}\", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'",
  "      ${If} $1 == 0",
  "        System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'",
  "        StrCpy $0 $1",
  "        System::Call 'OLE32::CoTaskMemFree(p r2)'",
  "      ${endif}",
  "      System::Store L"
].join('\n')

const SAFE_COPY = [
  "      Push $1",
  "      Push $2",
  "      # UserProgramFiles is the per-user install root and can be a non-default location",
  "      StrCpy $2 0",
  "      System::Call 'SHELL32::SHGetKnownFolderPath(g \"${FOLDERID_UserProgramFiles}\", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'",
  "      ${If} $1 == 0",
  "        System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'",
  "      ${endif}",
  "      # SHGetKnownFolderPath may return allocated memory even on failure",
  "      ${If} $2 != 0",
  "        System::Call 'OLE32::CoTaskMemFree(p r2)'",
  "      ${endif}",
  "      Pop $2",
  "      Pop $1"
].join('\n')
const FIXED_MACRO = LEGACY_MACRO.replace(UNSAFE_COPY, SAFE_COPY)

function patchNsisSource(source) {
  const normalized = source.replace(/\r\n/g, '\n')
  const macros = [...normalized.matchAll(/^  !macro setInstallModePerUser\n[\s\S]*?^  !macroend/gm)]
  if (macros.length !== 1) throw new Error('Expected exactly one setInstallModePerUser macro; review electron-builder before packaging')
  const current = macros[0][0]
  if (current === FIXED_MACRO) return source
  if (current !== LEGACY_MACRO) throw new Error('Unknown setInstallModePerUser structure; review the upstream NSIS fix before packaging')
  const patched = normalized.replace(LEGACY_MACRO, FIXED_MACRO)
  return source.includes('\r\n') ? patched.replace(/\n/g, '\r\n') : patched
}

function patchNsisFile(target) {
  const source = fs.readFileSync(target, 'utf8')
  const patched = patchNsisSource(source)
  if (patched !== source) fs.writeFileSync(target, patched)
  return patched !== source
}

if (require.main === module) {
  try {
    const target = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'multiUser.nsh')
    console.log(patchNsisFile(target) ? '[patch-nsis] Applied bounded UserProgramFiles copy' : '[patch-nsis] Bounded UserProgramFiles copy already applied')
  } catch (error) {
    console.error('[patch-nsis] ' + error.message)
    process.exitCode = 1
  }
}
module.exports = { patchNsisSource, patchNsisFile }
