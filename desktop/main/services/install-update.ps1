# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
param([Parameter(Mandatory=$true)][string]$LockPath, [string]$ExpectedJobId = '')
$ErrorActionPreference = 'Stop'
$job = Get-Content -LiteralPath ($LockPath + '.job') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($ExpectedJobId -and $job.id -ne $ExpectedJobId) { throw 'Update job was replaced before helper startup' }
$jobId = [string]$job.id
$owned = $false
$installed = $false
$parentExitedBeforeCommit = $false
try {
  # Exclusive creation prevents a late helper from replacing a newer helper's lock.
  $stream = [IO.File]::Open($LockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  try {
    $bytes = [Text.Encoding]::ASCII.GetBytes((@{ helperPid = $PID; jobId = $jobId; startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json))
    $stream.Write($bytes, 0, $bytes.Length)
    $owned = $true
  } finally { $stream.Dispose() }
  # Only the new application protocol requires commitment. Legacy manual migration
  # deliberately has no ExpectedJobId and retains its explicit caller-controlled flow.
  if ($ExpectedJobId) {
    $committed = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
      if ((Test-Path -LiteralPath ($LockPath + '.ack')) -and
          (Get-Content -LiteralPath ($LockPath + '.ack') -Raw -Encoding UTF8) -ceq $ExpectedJobId) { $committed = $true; break }
      if (-not (Get-Process -Id $job.parentPid -ErrorAction SilentlyContinue)) { $parentExitedBeforeCommit = $true; break }
      Start-Sleep -Milliseconds 100
    }
    if (-not $committed) { throw 'Application did not commit this update job' }
  }
  Wait-Process -Id $job.parentPid -ErrorAction SilentlyContinue
  if ((Get-FileHash -LiteralPath $job.installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $job.sha256) { throw 'Installer hash changed after preparation' }
  if ((Get-AuthenticodeSignature -LiteralPath $job.installer).Status -ne 'Valid') { throw 'Invalid installer signature' }
  $installer = Start-Process -FilePath $job.installer -ArgumentList @('/S', '--updated') -PassThru -Wait
  if ($installer.ExitCode -ne 0) { throw "Installer exited with $($installer.ExitCode)" }
  $installed = $true
  Remove-Item -LiteralPath ($LockPath + '.error') -Force -ErrorAction SilentlyContinue
} catch {
  if (-not $owned) { throw }
  $_ | Out-String | Set-Content -LiteralPath ($LockPath + '.error') -Encoding UTF8
} finally {
  $ownsLock = $false
  try {
    $current = Get-Content -LiteralPath $LockPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $ownsLock = $owned -and $current.helperPid -eq $PID -and [string]$current.jobId -ceq $jobId
  } catch { }
  $launch = $false
  if ($ownsLock) {
    $launch = $job.restart -or (Test-Path -LiteralPath ($LockPath + '.launch'))
    Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath ($LockPath + '.launch') -Force -ErrorAction SilentlyContinue
  }
  try {
    $currentJob = Get-Content -LiteralPath ($LockPath + '.job') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($owned -and [string]$currentJob.id -ceq $jobId -and $currentJob.parentPid -eq $job.parentPid) { Remove-Item -LiteralPath ($LockPath + '.job') -Force }
  } catch { }
  try {
    if ($owned -and (Get-Content -LiteralPath ($LockPath + '.ack') -Raw -Encoding UTF8) -ceq $jobId) { Remove-Item -LiteralPath ($LockPath + '.ack') -Force }
  } catch { }
  # A bridge failure can make the application's immediate relaunch defer to this
  # lock. Once the uncommitted parent has exited, reopen the unchanged application.
  if ($ownsLock -and $launch -and ($installed -or $parentExitedBeforeCommit)) { Start-Process -FilePath $job.executable }
}
