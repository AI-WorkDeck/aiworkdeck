# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Read-only QA probe. CreateNew permits readers before the helper finishes writing JSON.
function Read-UpgradeTestLock([string]$Path, [switch]$AllowLegacyJob) {
    try {
        $record = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        $job = Get-Content -LiteralPath ($Path + '.job') -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $record -or $null -eq $job) { return $null }
        $pidField = $record.PSObject.Properties['helperPid']
        $idField = $record.PSObject.Properties['jobId']
        $jobIdField = $job.PSObject.Properties['id']
        if ($null -eq $pidField -or $null -eq $idField) { return $null }
        $helperId = $pidField.Value
        if (($helperId -isnot [int] -and $helperId -isnot [long]) -or $helperId -le 0 -or $helperId -gt [int]::MaxValue) { return $null }
        $expected = if ($null -eq $jobIdField) { '' } else { [string]$jobIdField.Value }
        if ((-not $AllowLegacyJob -and -not $expected) -or [string]$idField.Value -cne $expected) { return $null }
        if (-not (Get-Process -Id $helperId -ErrorAction SilentlyContinue)) { return $null }
        return $record
    } catch { return $null }
}
