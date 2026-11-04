# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../scripts/read-upgrade-test-lock.ps1')
$dir = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory $dir | Out-Null
$lock = Join-Path $dir 'lock.json'
try {
    [IO.File]::WriteAllText(($lock + '.job'), '{"id":"expected"}')
    foreach ($raw in @('', '{"helperPid":', '{}', '{"helperPid":0,"jobId":"expected"}', '{"helperPid":"123","jobId":"expected"}', '{"helperPid":2147483647,"jobId":"expected"}', "{`"helperPid`":$PID,`"jobId`":`"wrong`"}")) {
        [IO.File]::WriteAllText($lock, $raw)
        if ($null -ne (Read-UpgradeTestLock $lock)) { throw "Accepted invalid lock: $raw" }
    }
    [IO.File]::WriteAllText($lock, "{`"helperPid`":$PID,`"jobId`":`"expected`"}")
    if ((Read-UpgradeTestLock $lock).helperPid -ne $PID) { throw 'Rejected complete live matching record' }
    [IO.File]::WriteAllText(($lock + '.job'), '{}')
    [IO.File]::WriteAllText($lock, "{`"helperPid`":$PID,`"jobId`":`"`"}")
    if ($null -ne (Read-UpgradeTestLock $lock)) { throw 'AppUpdater accepted legacy job' }
    if ((Read-UpgradeTestLock $lock -AllowLegacyJob).helperPid -ne $PID) { throw 'Rejected explicit legacy record' }
    Write-Output 'Lock probe rejected partial/foreign/dead records and accepted matching live records'
} finally { Remove-Item -LiteralPath $dir -Recurse -Force }
