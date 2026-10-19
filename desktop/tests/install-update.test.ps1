# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('awd-update-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
function Wait-Process { param($Id, $ErrorAction) }
function Get-AuthenticodeSignature { param($LiteralPath) return @{ Status = 'Valid' } }
function Start-Process {
  param($FilePath, $ArgumentList, [switch]$PassThru, [switch]$Wait)
  if ($FilePath -eq $script:installerPath) {
    if (($ArgumentList -join ' ') -ne '/S --updated') { throw 'Wrong NSIS arguments' }
    if ($script:installerExit -eq 0) { Set-Content -LiteralPath $script:executable -Value 'new version' }
    return @{ ExitCode = $script:installerExit }
  }
  $script:launches++
}
try {
  foreach ($failure in @($false, $true)) {
    $caseDir = Join-Path $root ([guid]::NewGuid().ToString('N'))
    # Build non-ASCII names without relying on PowerShell 5.1's script encoding.
    $appDir = Join-Path $caseDir (([char]0x6D4B).ToString() + [char]0x8BD5 + ' AI WorkDeck')
    New-Item -ItemType Directory -Path $appDir -Force | Out-Null
    $script:executable = Join-Path $appDir 'AI WorkDeck.exe'
    Set-Content -LiteralPath $script:executable -Value 'old version'
    $script:installerPath = Join-Path $appDir 'update.exe'
    Set-Content -LiteralPath $script:installerPath -Value 'synthetic installer'
    $lockPath = Join-Path $caseDir 'installing.json'
    $script:installerExit = if ($failure) { 1 } else { 0 }
    $script:launches = 0
    $jobJson = @{ parentPid = 4242; installer = $script:installerPath; executable = $script:executable; restart = $false;
       sha256 = (Get-FileHash $script:installerPath).Hash.ToLowerInvariant() } | ConvertTo-Json
    # Match Node fs.writeFileSync: UTF-8 without a BOM.
    [IO.File]::WriteAllText(($lockPath + '.job'), $jobJson, (New-Object Text.UTF8Encoding($false)))
    & (Join-Path $PSScriptRoot '../main/services/install-update.ps1') $lockPath
    $expected = if ($failure) { 'old version' } else { 'new version' }
    if ((Get-Content -LiteralPath $script:executable -Raw).Trim() -ne $expected) { throw "Wrong installed content: $expected" }
    if ($failure -and !(Test-Path ($lockPath + '.error'))) { throw 'Installer failure was not recorded' }
    if (!(Test-Path $script:installerPath)) { throw 'Verified installer must remain available for retry' }
    if (Test-Path $lockPath) { throw 'Installation lock left behind' }
    if ($script:launches -ne 0) { throw 'Ordinary quit must not relaunch' }
  }
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
