# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Guard-page technique adapted from Adam Gauthier's repro in upstream PR #9769:
# https://github.com/electron-userland/electron-builder/pull/9769
# Fixed source commit: a356198ec7c54c7795659342bff36d9a5162cd93
# Upstream template/repro portions retain the following MIT notice.
<#
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
#>
param([string]$MakensisPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
    throw 'Run the deliberate crash fixture only in a disposable Windows Actions runner.'
}
if (-not $MakensisPath) {
    $MakensisPath = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis\nsis-3.0.4.1\Bin\makensis.exe'
}
$makensis = (Resolve-Path -LiteralPath $MakensisPath).Path
$template = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../node_modules/app-builder-lib/templates/nsis/multiUser.nsh')
$blocks = [regex]::Matches($template, '(?ms)^      Push \$1\r?\n      Push \$2\r?\n.*?^      Pop \$1')
if ($blocks.Count -ne 1) { throw 'Expected the patched per-user copy block exactly once.' }
$fixed = $blocks[0].Value.Replace("`r`n", "`n")
$knownFolderCopy = $fixed
$api = 'System::Call ''SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'''
$free = 'System::Call ''OLE32::CoTaskMemFree(p r2)'''
if (-not $fixed.Contains($api) -or -not $fixed.Contains($free) -or -not $fixed.Contains('KERNEL32::lstrcpynW')) {
    throw 'Patched known-folder block changed; review the guard-page fixture.'
}
# Replace only allocation/ownership boundaries: exercise the actual installed
# template's copy, HRESULT branch and register preservation against a guard page.
$fixed = $fixed.Replace($api, "StrCpy `$2 `$3`n      StrCpy `$1 0").Replace($free, '; VirtualAlloc fixture is released by VirtualFree below')
$unsafe = @'
  System::Store S
  System::Call '*$3(&w${NSIS_MAX_STRLEN} .s)'
  StrCpy $0 $1
  System::Store L
'@
$sample = @'
Unicode true
Name "known-folder-guard"
OutFile "__OUTFILE__"
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
Function .onInit
  # Suppress the crash dialog for the intentional negative control.
  System::Call 'KERNEL32::SetErrorMode(i 0x8003)i'
  System::Call 'KERNEL32::VirtualAlloc(p 0, i 8192, i 0x2000, i 0x01)p.r4'
  StrCmp $4 0 failed
  System::Call 'KERNEL32::VirtualAlloc(p r4, i 4096, i 0x1000, i 0x04)p.r5'
  StrCmp $5 0 failed
  IntOp $3 $4 + 4080
  System::Call '*$3(&w8 "abc")'
  StrCpy $0 "fallback"
  StrCpy $1 "sentinel-one"
  StrCpy $2 "sentinel-two"
__COPY__
  StrCmp $0 "abc" 0 failed
  StrCmp $1 "sentinel-one" 0 failed
  StrCmp $2 "sentinel-two" 0 failed
  System::Call 'KERNEL32::VirtualFree(p r4, i 0, i 0x8000)i'
  SetErrorLevel 0
  Return
failed:
  SetErrorLevel 17
  Quit
FunctionEnd
Section "Main"
SectionEnd
'@
$knownFolder = @'
Unicode true
Name "known-folder-api"
OutFile "__OUTFILE__"
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!define FOLDERID_UserProgramFiles {5CD7AEE2-2219-4A67-B85D-6C9CE15660CB}
# Match production: create the known folder if missing in this disposable runner.
# Flag 0 would make the copy test depend on the folder already existing.
!define KF_FLAG_CREATE 0x8000
Function .onInit
  StrCpy $0 "fallback"
  StrCpy $1 "sentinel-one"
  StrCpy $2 "sentinel-two"
__COPY__
  StrCmp $0 "fallback" failed
  StrCmp $0 "" failed
  StrCmp $1 "sentinel-one" 0 failed
  StrCmp $2 "sentinel-two" 0 failed
  SetErrorLevel 0
  Return
failed:
  SetErrorLevel 17
  Quit
FunctionEnd
Section "Main"
SectionEnd
'@
$work = Join-Path $env:RUNNER_TEMP ('nsis-known-folder-guard-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
Write-Host "NSIS guard-page artifacts: $work"
foreach ($case in @(
    @{ Name = 'unsafe'; Content = $sample.Replace('__COPY__', $unsafe); Exit = -1073741819 },
    @{ Name = 'patched'; Content = $sample.Replace('__COPY__', $fixed); Exit = 0 },
    @{ Name = 'known-folder'; Content = $knownFolder.Replace('__COPY__', $knownFolderCopy); Exit = 0 }
)) {
    $script = Join-Path $work ($case.Name + '.nsi')
    $exe = Join-Path $work ($case.Name + '.exe')
    $case.Content.Replace('__OUTFILE__', $exe) | Set-Content -LiteralPath $script -Encoding utf8
    & $makensis /WX /INPUTCHARSET UTF8 $script
    if ($LASTEXITCODE -ne 0) { throw "NSIS compile failed for $($case.Name): $LASTEXITCODE" }
    $process = Start-Process -FilePath $exe -ArgumentList '/S' -PassThru
    if (-not $process.WaitForExit(30000)) {
        & taskkill.exe /PID $process.Id /T /F | Out-Null
        throw "Guard-page fixture timed out: $($case.Name)"
    }
    $process.Refresh()
    $actual = $process.ExitCode
    Write-Host "$($case.Name): expected $($case.Exit), actual $actual"
    if ($actual -ne $case.Exit) { throw "Guard-page expectation failed: $($case.Name)" }
}
Write-Host 'PASS: unsafe fixed-width read crashes; installed bounded-copy block preserves path and registers.'
