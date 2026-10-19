# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
param([Parameter(Mandatory=$true)][string]$LockPath)
$ErrorActionPreference = 'Stop'
$job = Get-Content -LiteralPath ($LockPath + '.job') -Raw -Encoding UTF8 | ConvertFrom-Json
$lockTemp = $LockPath + '.tmp'
@{ helperPid = $PID; startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json | Set-Content -LiteralPath $lockTemp -Encoding ASCII
Move-Item -LiteralPath $lockTemp -Destination $LockPath -Force
$installed = $false
try {
  # Wait before touching the application. /S skips the custom installer GUI;
  # --updated preserves the existing installation and associations.
  Wait-Process -Id $job.parentPid -ErrorAction SilentlyContinue
  if ((Get-FileHash -LiteralPath $job.installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $job.sha256) { throw 'Installer hash changed after preparation' }
  if ((Get-AuthenticodeSignature -LiteralPath $job.installer).Status -ne 'Valid') { throw 'Invalid installer signature' }
  $installer = Start-Process -FilePath $job.installer -ArgumentList @('/S', '--updated') -PassThru -Wait
  if ($installer.ExitCode -ne 0) { throw "Installer exited with $($installer.ExitCode)" }
  $installed = $true
  Remove-Item -LiteralPath ($LockPath + '.error') -Force -ErrorAction SilentlyContinue
} catch {
  # Keep the verified download for a manual retry; never launch a failed install.
  $_ | Out-String | Set-Content -LiteralPath ($LockPath + '.error') -Encoding UTF8
} finally {
  Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
  $launch = $job.restart -or (Test-Path -LiteralPath ($LockPath + '.launch'))
  Remove-Item -LiteralPath ($LockPath + '.job') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath ($LockPath + '.launch') -Force -ErrorAction SilentlyContinue
  if ($installed -and $launch) { Start-Process -FilePath $job.executable }
}
