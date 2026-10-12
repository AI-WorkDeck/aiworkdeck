# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Run the actual NSIS installer in a disposable Windows Actions runner, never a user profile.
param([Parameter(Mandatory = $true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
    throw 'This registry smoke test requires a disposable Windows GitHub Actions runner.'
}

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$installDir = Join-Path $env:RUNNER_TEMP ('AI WorkDeck association smoke ' + [guid]::NewGuid().ToString('N'))
$exe = Join-Path $installDir 'AI WorkDeck.exe'
$extensions = @('doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'md', 'markdown', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp')
$progId = 'com.aiworkdeck.desktop.Document'
$otherHandler = 'AIWorkDeckSmoke.PreviousHandler'
$changedHandler = 'AIWorkDeckSmoke.ChangedHandler'
$classes = 'Software\Classes'
$appKey = "$classes\Applications\AI WorkDeck.exe"
$capabilities = 'Software\AI WorkDeck\Capabilities'
$registeredApps = 'Software\RegisteredApplications'
# NSIS selects the 64-bit registry view for this x64 installer.
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
$originalDefaults = @{}
$userChoices = @{}

function Read-Value([string]$Key, [string]$Name) {
    $item = $registry.OpenSubKey($Key)
    if ($null -eq $item) { return $null }
    try { return $item.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
    finally { $item.Dispose() }
}
function Has-Value([string]$Key, [string]$Name) {
    $item = $registry.OpenSubKey($Key)
    if ($null -eq $item) { return $false }
    try { return $item.GetValueNames() -contains $Name } finally { $item.Dispose() }
}
function Write-Value([string]$Key, [string]$Name, [string]$Value) {
    $item = $registry.CreateSubKey($Key)
    try { $item.SetValue($Name, $Value, [Microsoft.Win32.RegistryValueKind]::String) } finally { $item.Dispose() }
}
function Assert-Equal($Actual, $Expected, [string]$Label) {
    if ($Actual -cne $Expected) { throw "$Label expected <$Expected>, got <$Actual>" }
}
function Read-UserChoice([string]$Extension) {
    $item = $registry.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.$Extension\UserChoice")
    if ($null -eq $item) { return 'absent' }
    try {
        $values = [ordered]@{}
        foreach ($name in ($item.GetValueNames() | Sort-Object)) {
            $values[$name] = @{ kind = [string]$item.GetValueKind($name); value = $item.GetValue($name) }
        }
        return ConvertTo-Json -InputObject $values -Compress -Depth 5
    } finally { $item.Dispose() }
}
function Run-Installer([string]$Path, [string]$Arguments) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(300000)) {
        & taskkill.exe /PID $process.Id /T /F | Out-Null
        throw "Installer exceeded five minutes: $Path"
    }
    # Refresh the process object after WaitForExit before reading its native exit status.
    $process.Refresh()
    Assert-Equal $process.ExitCode 0 'NSIS exit code'
}
function Assert-Preserved([string]$Default) {
    foreach ($ext in $extensions) {
        Assert-Equal (Read-Value "$classes\.$ext" '') $Default ".$ext existing default"
        Assert-Equal (Has-Value "$classes\.$ext\OpenWithProgids" $otherHandler) $true ".$ext other candidate present"
        Assert-Equal (Read-Value "$classes\.$ext\OpenWithProgids" $otherHandler) '' ".$ext other candidate value"
        Assert-Equal (Read-UserChoice $ext) $userChoices[$ext] ".$ext UserChoice unchanged"
    }
}
function Assert-Installed([string]$Default) {
    Write-Host ('Expected executable: ' + $exe + '; registered command: ' + (Read-Value "$appKey\shell\open\command" ''))
    Assert-Equal (Test-Path -LiteralPath $exe -PathType Leaf) $true 'Installed application executable'
    foreach ($ext in $extensions) {
        Assert-Equal (Has-Value "$classes\.$ext\OpenWithProgids" $progId) $true ".$ext candidate present"
        Assert-Equal (Read-Value "$classes\.$ext\OpenWithProgids" $progId) '' ".$ext candidate value"
        Assert-Equal (Has-Value "$appKey\SupportedTypes" ".$ext") $true ".$ext supported type"
        Assert-Equal (Read-Value "$capabilities\FileAssociations" ".$ext") $progId ".$ext default-app capability"
    }
    $command = '"' + $exe + '" "%1"'
    Assert-Equal (Read-Value "$classes\$progId\shell\open\command" '') $command 'Quoted ProgID command'
    Assert-Equal (Read-Value "$appKey\shell\open\command" '') $command 'Quoted application command'
    Assert-Equal (Read-Value $registeredApps 'AI WorkDeck') $capabilities 'Default-app registration'
    Assert-Preserved $Default
    # /S without --force-run must not start the client or its backend against the runner profile.
    $running = @(Get-Process -Name 'AI WorkDeck' -ErrorAction SilentlyContinue)
    Assert-Equal $running.Count 0 'Silent installer must not launch application'
}

try {
    # Refuse a reused runner with an existing app registration, rather than overwrite it.
    foreach ($key in @("$classes\$progId", $appKey, $capabilities, "$classes\$otherHandler", "$classes\$changedHandler")) {
        $existing = $registry.OpenSubKey($key)
        if ($null -ne $existing) { $existing.Dispose(); throw "Requires a clean runner; key already exists: $key" }
    }
    if (Has-Value $registeredApps 'AI WorkDeck') { throw 'Requires a clean runner; application already registered.' }
    foreach ($ext in $extensions) {
        if ((Has-Value "$classes\.$ext\OpenWithProgids" $otherHandler) -or (Has-Value "$classes\.$ext\OpenWithProgids" $progId)) {
            throw "Requires a clean runner; test or application candidate exists for .$ext"
        }
        $item = $registry.OpenSubKey("$classes\.$ext")
        try {
            $exists = $null -ne $item -and $item.GetValueNames() -contains ''
            $originalDefaults[$ext] = @{ exists = $exists; value = (Read-Value "$classes\.$ext" ''); kind = $null }
            if ($exists) { $originalDefaults[$ext].kind = $item.GetValueKind('') }
        } finally { if ($null -ne $item) { $item.Dispose() } }
        $userChoices[$ext] = Read-UserChoice $ext
    }
    # Seed valid foreign handlers; change the user's default between installs to catch restoration bugs.
    Write-Value "$classes\$otherHandler\shell\open\command" '' '"C:\Windows\notepad.exe" "%1"'
    Write-Value "$classes\$changedHandler\shell\open\command" '' '"C:\Windows\notepad.exe" "%1"'
    foreach ($ext in $extensions) {
        Write-Value "$classes\.$ext" '' $otherHandler
        Write-Value "$classes\.$ext\OpenWithProgids" $otherHandler ''
    }
    # electron-builder 24 re-parses /D using StdUtils.GetParameter (CRT argv),
    # so quote its value to retain spaces; bare NSIS /D quoting rules do not apply here.
    Run-Installer $installer "/S /D=`"$installDir`""
    Assert-Installed $otherHandler
    Write-Host 'PASS: real installer registers all 17 types without replacing existing defaults.'

    foreach ($ext in $extensions) { Write-Value "$classes\.$ext" '' $changedHandler }
    Run-Installer $installer "/S /D=`"$installDir`""
    Assert-Installed $changedHandler
    Write-Host 'PASS: reinstall preserves a default changed after the first installation.'

    $uninstaller = Join-Path $installDir 'Uninstall AI WorkDeck.exe'
    Assert-Equal (Test-Path -LiteralPath $uninstaller -PathType Leaf) $true 'Uninstaller present'
    # _?= keeps the uninstaller in this process instead of spawning a temporary copy and exiting early.
    Run-Installer $uninstaller "/S _?=$installDir"
    Assert-Equal (Test-Path -LiteralPath $exe) $false 'Application removed'
    foreach ($ext in $extensions) {
        Assert-Equal (Has-Value "$classes\.$ext\OpenWithProgids" $progId) $false ".$ext app candidate removed"
    }
    foreach ($key in @("$classes\$progId", $appKey, $capabilities)) {
        $remaining = $registry.OpenSubKey($key)
        if ($null -ne $remaining) { $remaining.Dispose(); throw "Uninstall left application registration: $key" }
    }
    Assert-Equal (Has-Value $registeredApps 'AI WorkDeck') $false 'Default-app registration removed'
    Assert-Preserved $changedHandler
    Write-Host 'PASS: uninstall removes application candidates and preserves other defaults, candidates and UserChoice.'
} finally {
    # Only restore values captured by this run and remove this test's own foreign handler candidates.
    foreach ($ext in $originalDefaults.Keys) {
        $item = $registry.OpenSubKey("$classes\.$ext", $true)
        if ($null -ne $item) {
            try {
                if ($originalDefaults[$ext].exists) { $item.SetValue('', $originalDefaults[$ext].value, $originalDefaults[$ext].kind) }
                else { $item.DeleteValue('', $false) }
            } finally { $item.Dispose() }
        }
        $item = $registry.OpenSubKey("$classes\.$ext\OpenWithProgids", $true)
        if ($null -ne $item) { try { $item.DeleteValue($otherHandler, $false) } finally { $item.Dispose() } }
    }
    if ($originalDefaults.Count -eq $extensions.Count) {
        $registry.DeleteSubKeyTree("$classes\$otherHandler", $false)
        $registry.DeleteSubKeyTree("$classes\$changedHandler", $false)
    }
    $registry.Dispose()
}
