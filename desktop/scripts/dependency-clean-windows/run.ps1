# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
param([Parameter(Mandatory=$true)][string]$Installer, [Parameter(Mandatory=$true)][string]$OutDir)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Only disposable GitHub-hosted Windows runners are supported; never run on a personal PC.'
}
$root = 'C:\awd-dependency-acceptance'
if (Test-Path $root) { throw 'Acceptance directory must be fresh' }
New-Item -ItemType Directory -Path $root,$OutDir | Out-Null
$account = 'awd-dependency-test'
$child = $null
function Wait-ProcessChecked($Process, [int]$Seconds, [string]$Label, [int[]]$Allowed = @(0)) {
    if (-not $Process.WaitForExit($Seconds * 1000)) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.Id /T /F | Out-Null
        throw "$Label exceeded $Seconds seconds"
    }
    $Process.Refresh()
    if ($Process.ExitCode -notin $Allowed) { throw "$Label exited $($Process.ExitCode)" }
    return $Process.ExitCode
}
function Download([string]$Url, [string]$Name, [string]$Hash) {
    $path = Join-Path $root $Name
    Invoke-WebRequest -Uri $Url -OutFile $path -TimeoutSec 600
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Hash) { throw "SHA256 mismatch: $Name" }
    $signature = Get-AuthenticodeSignature $path
    if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode signature: $Name ($($signature.Status))" }
    @{url=$Url;sha256=$actual;sha256Source=$(if ($Name -eq 'node.msi') { 'https://nodejs.org/dist/v22.23.3/SHASUMS256.txt' } else { $Url + '.sha256' });signer=$signature.SignerCertificate.Subject;status=[string]$signature.Status} |
        ConvertTo-Json | Set-Content (Join-Path $OutDir "$Name.source.json")
    return $path
}
try {
    @{imageOS=$env:ImageOS;imageVersion=$env:ImageVersion;os=[Environment]::OSVersion.VersionString;
      runner='GitHub-hosted Windows Server 2022, not clean consumer Windows';
      imageInventory='https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md';
      originalPath=$env:PATH;commands=@(Get-Command node,python,java,docker,soffice -ErrorAction SilentlyContinue | Select-Object Name,Source);
      virtualization=@(Get-CimInstance Win32_ComputerSystem | Select-Object HypervisorPresent,Model)} |
        ConvertTo-Json -Depth 6 | Set-Content (Join-Path $OutDir 'runner-before.json')
    # Remove MSI registration as well as payload: renaming alone makes a later MSI enter
    # maintenance mode or reject a downgrade, rather than exercising a real installation.
    $nodeRegistrations = @(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -eq 'Node.js' })
    $nodeRegistrations | Select-Object DisplayName,DisplayVersion,PSChildName | ConvertTo-Json | Set-Content (Join-Path $OutDir 'preinstalled-node.json')
    foreach ($registration in $nodeRegistrations) {
        $product = $registration.PSChildName
        if ($product -notmatch '^\{[0-9A-Fa-f-]{36}\}$') { throw 'Unknown Node uninstall registration; refusing arbitrary command execution' }
        $process = Start-Process "$env:SystemRoot\System32\msiexec.exe" -PassThru -ArgumentList "/x $product /qn /norestart /L*v $root\runner-node-uninstall.log"
        Wait-ProcessChecked $process 300 'Remove runner Node MSI' @(0,1605,3010) | Out-Null
    }
    # PATH exclusion alone is insufficient: production also discovers these default locations.
    # Quarantine only in this throwaway VM; record every move. Other preinstalled dev tools stay
    # installed, but are excluded from the child PATH. This is not an OS factory-reset claim.
    $quarantined = @()
    foreach ($path in @('C:\Program Files\nodejs','C:\Program Files (x86)\nodejs','C:\Program Files\LibreOffice',
            'C:\Program Files (x86)\LibreOffice','C:\Program Files\Docker',"$env:SystemRoot\System32\docker.exe")) {
        if (Test-Path $path) {
            $target = $path + '.awd-ci-quarantined'
            Move-Item -LiteralPath $path -Destination $target
            $quarantined += @{source=$path;destination=$target}
        }
    }
    $quarantined | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $OutDir 'quarantined.json')
    $password = ConvertTo-SecureString ('Awd!' + [guid]::NewGuid().ToString('N') + '9a') -AsPlainText -Force
    New-LocalUser -Name $account -Password $password -Description 'Ephemeral dependency CI standard account' | Out-Null
    Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $account
    $credential = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\$account",$password)
    $sid = (Get-LocalUser $account).SID.Value
    & icacls.exe $root /grant "*${sid}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot grant isolated test directory access' }
    Copy-Item -LiteralPath $Installer -Destination "$root\installer.exe"
    $install = "$root\application"
    $process = Start-Process "$root\installer.exe" -Credential $credential -LoadUserProfile -ArgumentList "/S /D=$install" -PassThru
    Wait-ProcessChecked $process 360 'Actual NSIS install under standard user' | Out-Null
    $resources = "$install\resources"
    foreach ($path in @("$install\AI WorkDeck.exe", "$resources\backend\app.jar", "$resources\jre\bin\java.exe", "$resources\python\python.exe")) {
        if (-not (Test-Path $path -PathType Leaf)) { throw "Installed payload missing: $path" }
    }
    @{sha256=(Get-FileHash "$root\installer.exe").Hash;standardUser=$account;adminMember=$false} |
        ConvertTo-Json | Set-Content (Join-Path $OutDir 'installer.json')
    # Preparation uses setup-java's absolute javac, never the probe's runtime or discovery PATH.
    $classpath = "$resources\backend\app.jar;$resources\backend\lib\*"
    & "$env:JAVA_HOME\bin\javac.exe" -encoding UTF-8 --release 17 -cp $classpath -d $root "$PSScriptRoot\DependencyProbe.java" "$PSScriptRoot\RuntimeInstallProbe.java"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot compile probe against installed production classes' }
    $config = Get-Content 'backend/src/main/resources/application.yml' -Raw
    $publicKey = [regex]::Match($config, '(?s)-----BEGIN PUBLIC KEY-----.*?-----END PUBLIC KEY-----').Value -replace '(?m)^\s+', ''
    if (-not $publicKey) { throw 'Missing published pack verification key' }
    $publicKey | Set-Content "$root\public.pem" -Encoding ascii
    $version = (Get-Content desktop/package.json -Raw | ConvertFrom-Json).version
    Copy-Item 'official-plugins/dpia-workbench' "$root\dpia-workbench" -Recurse
    # Copy only the acceptance inputs into the standard user's writable test root.
    # No checkout credentials, development dependencies or unrelated files are inherited.
    foreach ($file in @('backend/src/main/resources/application.yml','desktop/package.json',
        'desktop/main/services/model-fetch.py','desktop/main/services/model-inventory.js','desktop/main/services/pysvc-runtime.js',
        'asr-service/app.py','asr-service/tests/real_inference.py','kokoro-service/app.py',
        'desktop/scripts/dependency-clean-windows/model-prepare.cjs','desktop/scripts/dependency-clean-windows/real-models.ps1')) {
        $destination = Join-Path "$root\source" $file
        New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
        Copy-Item -LiteralPath $file -Destination $destination
    }
    # Powershell child initializes the new real profile, validates the token, and drops inherited
    # overrides. A standard user cannot turn a dependency install failure into an admin success.
    @'
param($Root, $Resources, $Version)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Probe must run without administrator token' }
$env:USERPROFILE = [Environment]::GetFolderPath('UserProfile')
if ($env:USERPROFILE -notlike '*awd-dependency-test*') { throw 'Probe did not receive a fresh user profile' }
$env:APPDATA = [Environment]::GetFolderPath('ApplicationData')
$env:LOCALAPPDATA = [Environment]::GetFolderPath('LocalApplicationData')
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
foreach ($name in @('JAVA_HOME','PYTHONHOME','PYTHONPATH','NODE_PATH','NODE_OPTIONS','LIBREOFFICE_PATH','SOFFICE_PATH','TMEET_PATH','TMEET_NODE_PATH','DOCKER_HOST','DOCKER_CONTEXT')) {
    [Environment]::SetEnvironmentVariable($name,$null,'Process')
}
Set-Location $Root
function Run-Native([string]$Executable, [string[]]$Arguments, [string]$Log) {
    $quoted = @($Arguments | ForEach-Object {
        if ($_ -match '"' -or $_.EndsWith('\')) { throw 'Unsupported native argument' }
        '"' + $_ + '"'
    }) -join ' '
    # PS5 otherwise decodes native stderr as an error record and can stop on a
    # harmless warning; direct redirection also preserves original UTF-8 bytes.
    $process = Start-Process $Executable -ArgumentList $quoted -NoNewWindow -PassThru -Wait `
        -RedirectStandardOutput "$Root\$Log.log" -RedirectStandardError "$Root\$Log.stderr.log"
    if ($process.ExitCode -ne 0) { throw "$Log exited $($process.ExitCode); inspect its stdout/stderr logs" }
}
Run-Native "$Resources\jre\bin\java.exe" @('-Dfile.encoding=UTF-8','-Djava.awt.headless=true','-cp',"$Root;$Resources\backend\app.jar;$Resources\backend\lib\*",'DependencyProbe',$Root,$Resources,$Version) 'probe'
Run-Native "$Resources\python\python.exe" @('-I','-m','venv',"$Root\dpia-venv") 'dpia-venv'
$python = "$Root\dpia-venv\Scripts\python.exe"
$env:PYTHONIOENCODING = 'utf-8'
$env:DSH_DPIA_PDF_FONT = "$Resources\frontend\dist\zetaoffice\cjk-kai.ttf"
$env:AWD_DPIA_SOFFICE = $null
$check = "$Root\dpia-workbench\runtime\environment-check.py"
Run-Native $python @($check) 'dpia-before'
$before = Get-Content "$Root\dpia-before.log" -Raw -Encoding UTF8
$before | Set-Content "$Root\dpia-before.json" -Encoding utf8
if (@(($before | ConvertFrom-Json).checks | Where-Object { $_.status -eq 'needs_attention' }).Count -eq 0) { throw 'Fresh DPIA venv unexpectedly contains dependencies' }
Run-Native $python @('-m','pip','install','--disable-pip-version-check','-r',"$Root\dpia-workbench\runtime\requirements.txt") 'dpia-pip'
Run-Native $python @($check) 'dpia-after'
$after = Get-Content "$Root\dpia-after.log" -Raw -Encoding UTF8
$after | Set-Content "$Root\dpia-after.json" -Encoding utf8
if (@(($after | ConvertFrom-Json).checks | Where-Object { $_.status -ne 'ready' }).Count) { throw 'DPIA preparation remains incomplete' }
$env:AWD_DPIA_TEST_PYTHON = $python
Run-Native 'C:\Program Files\nodejs\node.exe' @('--test',"$Root\dpia-workbench\tests\lifecycle.test.mjs") 'dpia-lifecycle'
& "$Root\source\desktop\scripts\dependency-clean-windows\real-models.ps1" -Resources $Resources -Repo "$Root\source" -Output "$Root\real-models" -ProbeClasses $Root *> "$Root\real-models.log"
'@ | Set-Content "$root\probe.ps1" -Encoding utf8
    $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $savedModulePath = $env:PSModulePath
    try {
        Remove-Item Env:PSModulePath -ErrorAction SilentlyContinue
        $child = Start-Process $powershell -Credential $credential -LoadUserProfile -PassThru -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File $root\probe.ps1 $root $resources $version" -RedirectStandardOutput "$root\child.stdout.log" -RedirectStandardError "$root\child.stderr.log"
    } finally { $env:PSModulePath = $savedModulePath }
    $deadline = (Get-Date).AddMinutes(3)
    while (-not (Test-Path "$root\before.json")) {
        $child.Refresh()
        if ($child.HasExited -or (Get-Date) -gt $deadline) { throw 'Missing-dependency stage failed; inspect probe.log' }
        Start-Sleep -Seconds 1
    }
    $node = Download 'https://nodejs.org/dist/v22.23.3/node-v22.23.3-x64.msi' 'node.msi' '1c0efc8449987e7da5d184786a0a96da83ffa11d334421201e5c09b93017cb8d'
    $lo = Download 'https://downloadarchive.documentfoundation.org/libreoffice/old/25.8.4.2/win/x86_64/LibreOffice_25.8.4.2_Win_x86-64.msi' 'libreoffice.msi' 'b2b23d91bda5ad6e97b38008b082060a55d2a3c7c269b2c0e78daca865133d48'
    $msiexec = "$env:SystemRoot\System32\msiexec.exe"
    $denied = Start-Process $msiexec -Credential $credential -LoadUserProfile -PassThru -ArgumentList "/i $node /qn /norestart ALLUSERS=1 /L*v $root\node-standard-user.log"
    if (-not $denied.WaitForExit(120000)) { & taskkill.exe /PID $denied.Id /T /F | Out-Null; throw 'Non-admin MSI did not fail within two minutes' }
    $denied.Refresh()
    $denial = @(Select-String -Path "$root\node-standard-user.log" -Pattern 'Error 1925|do not have sufficient privileges|installation is forbidden by system policy|requires elevation' -ErrorAction SilentlyContinue | ForEach-Object { $_.Line })
    @{exitCode=$denied.ExitCode;permissionEvidence=$denial;expected='Machine-wide MSI cannot silently elevate standard account'} | ConvertTo-Json | Set-Content "$root\non-admin.json"
    if ($denied.ExitCode -in @(0,3010)) { throw 'Unexpected standard-user machine-wide install success; isolation assumption invalid' }
    if ($denied.ExitCode -ne 1625 -and $denial.Count -eq 0) { throw 'Non-admin MSI failed without permission evidence; inspect node-standard-user.log rather than claiming elevation was denied' }
    foreach ($entry in @(@($node,'node'),@($lo,'libreoffice'))) {
        $process = Start-Process $msiexec -PassThru -ArgumentList "/i $($entry[0]) /qn /norestart ALLUSERS=1 /L*v $root\$($entry[1])-install.log"
        Wait-ProcessChecked $process 600 "$($entry[1]) official MSI" @(0,3010) | Out-Null
    }
    $tmeetMetadata = Invoke-RestMethod 'https://registry.npmjs.org/@tencentcloud%2ftmeet/1.0.19' -TimeoutSec 60
    if ($tmeetMetadata.repository.url -ne 'git+https://github.com/TencentCloud/tencentmeeting-cli.git' -or
        $tmeetMetadata.dist.integrity -ne 'sha512-crhW1OhIhwgSJ6eaznS4AoAQYXIK/fToN2VHgHCNBi6JFG0XaEJkRbOTFuDbbMlNvH/FnWI1vEo3fw9Dv/S00A==') { throw 'Unexpected official tmeet package metadata' }
    @{name=$tmeetMetadata.name;version=$tmeetMetadata.version;repository=$tmeetMetadata.repository.url;integrity=$tmeetMetadata.dist.integrity} |
        ConvertTo-Json | Set-Content "$root\tmeet-source.json"
    # Real official npm package install; no OAuth login, no user account or production secrets.
    $npmCli = 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js'
    $process = Start-Process 'C:\Program Files\nodejs\node.exe' -PassThru -ArgumentList "`"$npmCli`" install --global --prefix $root\npm --ignore-scripts @tencentcloud/tmeet@1.0.19" -RedirectStandardOutput "$root\npm-install.log" -RedirectStandardError "$root\npm-install.stderr.log"
    Wait-ProcessChecked $process 300 'Official tmeet npm installation' | Out-Null
    New-Item "$root\installed.ready" -ItemType File | Out-Null
    Wait-ProcessChecked $child 4200 'Same-process recovery, conversion, pack, DPIA and real model inference' | Out-Null
    if (-not (Test-Path "$root\core-passed.json")) { throw 'Probe did not report completion' }
    if (-not (Test-Path "$root\real-models\inference\report.json")) { throw 'Real model inference report missing' }
    @{passed=$true;core='core-passed.json';dpia='dpia-lifecycle.log';models='real-models/inference/report.json';standardUser=$account} | ConvertTo-Json | Set-Content "$root\passed.json"
} finally {
    if ($child -and -not $child.HasExited) { & taskkill.exe /PID $child.Id /T /F | Out-Null }
    # No installations, npm packages, model archives, credentials or user profile enter artifacts.
    Get-ChildItem $root -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @('.json','.log','.txt','.png','.pdf','.docx','.dot','.svg') } |
        Copy-Item -Destination $OutDir -Force
    foreach ($directory in @('real-models','real-models/inference')) {
        $source = Join-Path $root $directory
        if (Test-Path $source) {
            $destination = Join-Path $OutDir $directory
            New-Item -ItemType Directory -Path $destination -Force | Out-Null
            Get-ChildItem $source -File | Where-Object { $_.Extension -in @('.json','.log','.wav') } |
                Copy-Item -Destination $destination -Force
        }
    }
    if (Get-LocalUser $account -ErrorAction SilentlyContinue) { Remove-LocalUser $account }
}
