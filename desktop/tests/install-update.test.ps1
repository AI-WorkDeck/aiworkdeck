# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('awd-update-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
# The helper is a separate script scope; keep mock state in this isolated process.
$global:AwdInstallerFixture = @{ installerPath = ''; executable = ''; installerExit = 0; launches = 0; installs = 0 }
function Wait-Process { param($Id, $ErrorAction) }
function Get-AuthenticodeSignature { param($LiteralPath) return @{ Status = 'Valid' } }
function Start-Process {
  param($FilePath, $ArgumentList, [switch]$PassThru, [switch]$Wait)
  if ($FilePath -eq $global:AwdInstallerFixture.installerPath) {
    $global:AwdInstallerFixture.installs++
    if (($ArgumentList -join ' ') -ne '/S --updated') { throw 'Wrong NSIS arguments' }
    if ($global:AwdInstallerFixture.installerExit -eq 0) { Set-Content -LiteralPath $global:AwdInstallerFixture.executable -Value 'new version' }
    return @{ ExitCode = $global:AwdInstallerFixture.installerExit }
  }
  $global:AwdInstallerFixture.launches++
}
try {
  foreach ($failure in @($false, $true)) {
    $caseDir = Join-Path $root ([guid]::NewGuid().ToString('N'))
    # Build non-ASCII names without relying on PowerShell 5.1's script encoding.
    $appDir = Join-Path $caseDir (([char]0x6D4B).ToString() + [char]0x8BD5 + ' AI WorkDeck')
    New-Item -ItemType Directory -Path $appDir -Force | Out-Null
    $global:AwdInstallerFixture.executable = Join-Path $appDir 'AI WorkDeck.exe'
    Set-Content -LiteralPath $global:AwdInstallerFixture.executable -Value 'old version'
    $global:AwdInstallerFixture.installerPath = Join-Path $appDir 'update.exe'
    Set-Content -LiteralPath $global:AwdInstallerFixture.installerPath -Value 'synthetic installer'
    $lockPath = Join-Path $caseDir 'installing.json'
    $global:AwdInstallerFixture.installerExit = if ($failure) { 1 } else { 0 }
    $global:AwdInstallerFixture.launches = 0
    $global:AwdInstallerFixture.installs = 0
    $jobJson = @{ parentPid = 4242; installer = $global:AwdInstallerFixture.installerPath; executable = $global:AwdInstallerFixture.executable; restart = $false;
       sha256 = (Get-FileHash $global:AwdInstallerFixture.installerPath).Hash.ToLowerInvariant() } | ConvertTo-Json
    # Match Node fs.writeFileSync: UTF-8 without a BOM.
    [IO.File]::WriteAllText(($lockPath + '.job'), $jobJson, (New-Object Text.UTF8Encoding($false)))
    & (Join-Path $PSScriptRoot '../main/services/install-update.ps1') $lockPath
    $expected = if ($failure) { 'old version' } else { 'new version' }
    $helperError = if (Test-Path -LiteralPath ($lockPath + '.error')) { Get-Content -LiteralPath ($lockPath + '.error') -Raw -Encoding UTF8 } else { '<no helper error>' }
    if ((Get-Content -LiteralPath $global:AwdInstallerFixture.executable -Raw).Trim() -ne $expected) { throw "Wrong installed content: $expected; helper error: $helperError" }
    if ($global:AwdInstallerFixture.installs -ne 1) { throw "Installer was not called exactly once; helper error: $helperError" }
    if ($failure -and !(Test-Path ($lockPath + '.error'))) { throw 'Installer failure was not recorded' }
    if (!(Test-Path $global:AwdInstallerFixture.installerPath)) { throw 'Verified installer must remain available for retry' }
    if (Test-Path $lockPath) { throw 'Installation lock left behind' }
    if ($global:AwdInstallerFixture.launches -ne 0) { throw 'Ordinary quit must not relaunch' }
  }
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force
  Remove-Variable -Name AwdInstallerFixture -Scope Global
}
