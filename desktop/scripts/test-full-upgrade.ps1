# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Real signed NSIS installs on a disposable runner. No mocked installer/signature/process APIs.
# LegacyHelper measures new helper compatibility with an old install, NOT old-shell auto-update.
# AppUpdater requires a separately signed older-version baseline containing the new updater.
param(
    [Parameter(Mandatory = $true)][string]$OldInstaller,
    [Parameter(Mandatory = $true)][string]$CandidateInstaller,
    [Parameter(Mandatory = $true)][string]$CandidateVersion,
    [string]$OldVersion = '0.65.0',
    [ValidateSet('LegacyHelper', 'AppUpdater')][string]$Mechanism = 'LegacyHelper',
    [ValidateSet('Restart', 'Quit', 'Reopen')][string]$ExitMode = 'Restart',
    [Parameter(Mandatory = $true)][string]$OutDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'read-upgrade-test-lock.ps1')
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
    throw 'Requires a disposable Windows GitHub Actions runner; never run against a user profile.'
}
if ($Mechanism -eq 'LegacyHelper' -and $ExitMode -eq 'Reopen') { throw 'The released old shell has no install lock; Reopen requires AppUpdater baseline.' }
if ([version]$CandidateVersion -le [version]$OldVersion) { throw 'Candidate must be newer than baseline.' }
if ($Mechanism -eq 'AppUpdater' -and ([version]$CandidateVersion).Major -eq ([version]$OldVersion).Major -and ([version]$CandidateVersion).Minor -eq ([version]$OldVersion).Minor) { throw 'Native AppUpdater QA requires different update channels; same-channel releases use patches.' }
$OldInstaller = (Resolve-Path -LiteralPath $OldInstaller).Path
$CandidateInstaller = (Resolve-Path -LiteralPath $CandidateInstaller).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$dataDir = Join-Path $env:USERPROFILE '.aiworkdeck'
if (Test-Path -LiteralPath $dataDir) { throw "Refusing existing app data: $dataDir" }
if (@(Get-Process -Name 'AI WorkDeck' -ErrorAction SilentlyContinue).Count) { throw 'An app is already running.' }
$installDir = Join-Path $env:RUNNER_TEMP ('AI WorkDeck upgrade ' + [guid]::NewGuid().ToString('N'))
$exe = Join-Path $installDir 'AI WorkDeck.exe'
$lock = Join-Path $dataDir 'updates/installer/installing.json'
$api = 'http://127.0.0.1:19566'
$cdpPort = 19567
$env:CHECKBA_BACKEND_PORT = '19566'
# Block production update checks. AppUpdater replaces this with a signed local fixture feed.
$env:CHECKBA_UPDATE_MANIFEST_URL = 'http://127.0.0.1:19568/manifest.json'
$evidence = [ordered]@{ mechanism = $Mechanism; exitMode = $ExitMode; oldVersion = $OldVersion; candidateVersion = $CandidateVersion; installDir = $installDir; dataDir = $dataDir; assertions = @(); signatures = @(); versions = @() }
$feed = $null
$helperProcess = $null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class UpgradeWindow {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
function Assert-That([bool]$Value, [string]$Label) {
    if (-not $Value) { throw $Label }
    $script:evidence.assertions += $Label
    Write-Host "PASS: $Label"
}
function Assert-ExeVersion([string]$Expected, [string]$Label) {
    $info = (Get-Item -LiteralPath $exe).VersionInfo
    $actual = $info.ProductVersion
    $script:evidence.versions += @{ expected = $Expected; productVersion = $actual; fileVersion = $info.FileVersion; path = $exe }
    Write-Host "Executable version: ProductVersion=[$actual], FileVersion=[$($info.FileVersion)], expected=[$Expected]"
    # Windows PE resources may encode the semver release with a fourth zero component.
    Assert-That ($actual -ceq $Expected -or $actual -ceq "$Expected.0") $Label
}
function Wait-Until([scriptblock]$Check, [string]$Label, [int]$Seconds = 180) {
    $end = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $end) {
        if (& $Check) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out: $Label"
}
function Signature([string]$File) {
    $s = Get-AuthenticodeSignature -LiteralPath $File
    Assert-That ($s.Status -eq 'Valid') "Authenticode valid: $([IO.Path]::GetFileName($File))"
    Assert-That ($null -ne $s.TimeStamperCertificate) "Timestamp present: $([IO.Path]::GetFileName($File))"
    Assert-That ($s.SignerCertificate.Subject -match 'Zhen Shan Mei Grace Legacy US Limited') 'Expected signing publisher'
    $script:evidence.signatures += @{ file = $File; status = [string]$s.Status; publisher = $s.SignerCertificate.Subject; thumbprint = $s.SignerCertificate.Thumbprint; timestamp = $s.TimeStamperCertificate.Subject; sha256 = (Get-FileHash -LiteralPath $File).Hash }
}
function Screenshot([string]$Name) {
    $bounds = [Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object Drawing.Bitmap($bounds.Width, $bounds.Height)
    $g = [Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.Size); $bmp.Save((Join-Path $OutDir "$Name.png")) }
    finally { $g.Dispose(); $bmp.Dispose() }
}
function Api([string]$Route, $Body = $null) {
    if ($null -eq $Body) { return Invoke-RestMethod "$api/api$Route" -TimeoutSec 15 }
    return Invoke-RestMethod "$api/api$Route" -Method Post -ContentType 'application/json' -Body (ConvertTo-Json -InputObject $Body -Depth 10) -TimeoutSec 30
}
function Wait-Backend {
    $jar = Join-Path $installDir 'resources/backend/app.jar'
    $expected = & node -e 'const s=require("fs").statSync(process.argv[1]); process.stdout.write(s.size+"-"+Math.round(s.mtimeMs))' $jar
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify installed backend JAR' }
    Wait-Until { try { $r = Api '/admin/wizard'; return ($r.initialized -is [bool]) -and $r.build -eq $expected } catch { return $false } } 'real bundled backend ready with installed JAR identity' 240
}
# Node's WebSocket talks to the installed Electron renderer. No replacement preload or renderer.
$cdpScript = @'
const [port, method, params] = process.argv.slice(1);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(t => t.type === 'page' && /index\.html/.test(t.url));
if (!target) throw Error('Installed workbench renderer not found');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let replied = false;
const timer = setTimeout(() => { console.error('CDP timeout'); process.exit(1); }, 180000);
ws.onopen = () => ws.send(JSON.stringify({id: 1, method, params: JSON.parse(params)}));
ws.onmessage = e => { const r = JSON.parse(e.data); if (r.id !== 1) return; replied = true;
  if (r.error || r.result?.exceptionDetails) { console.error(JSON.stringify(r)); process.exitCode = 1; }
  else console.log(JSON.stringify(r.result));
  clearTimeout(timer); ws.close();
};
ws.onerror = e => { console.error(String(e.message)); process.exit(1); };
ws.onclose = () => { if (!replied) { console.error('Renderer closed before CDP reply'); process.exit(1); } };
'@
function Renderer([string]$Expression) {
    $params = ConvertTo-Json -Compress -InputObject @{ expression = $Expression; awaitPromise = $true; returnByValue = $true }
    $result = & node --input-type=module -e $cdpScript "$cdpPort" 'Runtime.evaluate' $params
    if ($LASTEXITCODE -ne 0) { throw "Installed renderer evaluation failed: $Expression" }
    return ($result | ConvertFrom-Json).result.value
}
function Wait-Renderer {
    Wait-Until { try { return (Renderer '!!window.checkbaDesktop?.update && !!document.querySelector(".page-project-overview")') -eq $true } catch { return $false } } 'installed workbench UI ready' 180
}
function Launch {
    return Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$cdpPort" -PassThru
}
# The production installer relaunches without CDP. Use the same native UI action for
# baseline and candidate; never bypass renderer save/quit preparation through IPC.
$exitDrivers = @()
$exitDialogDriver = @'
param([int]$TargetPid, [string]$EvidencePath)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ targetPid = $TargetPid; status = 'waiting'; invoked = $false }
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    $title = 'Review project changes before exiting'
    $label = 'Exit Without Committing'
    $dialogCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, $title)
    $buttonCondition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
    while ([DateTime]::UtcNow -lt $deadline) {
        $target = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
        if ($null -eq $target) { $result.status = 'exited-without-dialog'; break }
        if ($target.MainWindowHandle -ne [IntPtr]::Zero) {
            $root = [Windows.Automation.AutomationElement]::FromHandle($target.MainWindowHandle)
            $dialogs = $root.FindAll([Windows.Automation.TreeScope]::Descendants, $dialogCondition)
            foreach ($dialog in $dialogs) {
                if ($dialog.Current.ProcessId -ne $TargetPid -or $dialog.Current.IsOffscreen) { continue }
                $buttons = @($dialog.FindAll([Windows.Automation.TreeScope]::Descendants, $buttonCondition) | Where-Object { -not $_.Current.IsOffscreen })
                # A matching heading alone is not the modal. Verify its complete footer.
                $names = @($buttons | ForEach-Object { $_.Current.Name })
                if (($names -join '|') -notin @('Cancel|Exit Without Committing|Commit selected and exit', 'Cancel|Retry|Exit Without Committing|Commit selected and exit')) { continue }
                $button = $buttons[$buttons.Count - 2]
                if ($button.Current.ProcessId -ne $TargetPid -or $button.Current.Name -cne $label -or -not $button.Current.IsEnabled) { continue }
                $bounds = $button.Current.BoundingRectangle
                if ($bounds.Width -le 0 -or $bounds.Height -le 0) { continue }
                $pattern = $null
                if (-not $button.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { throw 'Exit button does not support native Invoke' }
                $result.dialog = $dialog.Current.Name
                $result.button = $button.Current.Name
                $result.buttonPid = $button.Current.ProcessId
                $result.footer = $names
                $result.enabled = $button.Current.IsEnabled
                $result.offscreen = $button.Current.IsOffscreen
                $result.status = 'invoking'
                $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $EvidencePath -Encoding utf8
                $pattern.Invoke()
                $result.invoked = $true
                $result.status = 'invoked'
                break
            }
            if ($result.invoked) { break }
        }
        Start-Sleep -Milliseconds 250
    }
    if ($result.status -eq 'waiting') { throw 'Visible enabled project-exit dialog was not found before deadline' }
} catch {
    $result.status = 'failed'
    $result.error = $_.Exception.Message
} finally {
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $EvidencePath -Encoding utf8
}
if ($result.status -eq 'failed') { exit 1 }
'@
function Start-ExitDialogDriver($Process) {
    $driver = Join-Path $OutDir 'exit-dialog-driver.ps1'
    $exitDialogDriver | Set-Content -LiteralPath $driver -Encoding utf8
    $record = Join-Path $OutDir ("exit-dialog-{0}-{1}.json" -f $Process.Id, $script:exitDrivers.Count)
    # Windows PowerShell supplies the native .NET Framework UI Automation assemblies.
    $observer = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', "`"$driver`"", '-TargetPid', $Process.Id, '-EvidencePath', "`"$record`"") -PassThru -WindowStyle Hidden
    $script:exitDrivers += @{ process = $observer; record = $record }
}
function Close-App($Process) {
    $Process.Refresh()
    Assert-That ($Process.MainWindowHandle -ne [IntPtr]::Zero) 'Real application window exists before close'
    Start-ExitDialogDriver $Process
    [UpgradeWindow]::PostMessage($Process.MainWindowHandle, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
}
try {
    Signature $OldInstaller
    Signature $CandidateInstaller
    # Parser changed between builder 24 and 26; bind the syntax to the verified baseline lockfile.
    $baselineBuild = Get-Content (Join-Path $OutDir 'baseline-build.json') -Raw | ConvertFrom-Json
    $baselineBuilder = Get-Content (Join-Path $OutDir 'baseline-installer-builder.json') -Raw | ConvertFrom-Json
    Assert-That ($baselineBuilder.sourceSha -ceq $baselineBuild.head_sha) 'Baseline installer parser bound to verified source'
    $oldArguments = switch ($baselineBuilder.directoryStyle) {
        'quoted' { "/S /D=`"$installDir`"" }
        'unquoted' { "/S /D=$installDir" }
        default { throw 'Unknown baseline NSIS directory syntax' }
    }
    $p = Start-Process -FilePath $OldInstaller -ArgumentList $oldArguments -PassThru
    Assert-That ($p.WaitForExit(300000)) 'Old NSIS completed within five minutes'
    $p.Refresh()
    Assert-That ($p.ExitCode -eq 0) 'Old NSIS exit code zero'
    Assert-That (Test-Path -LiteralPath $exe) 'Old application installed in explicit test directory'
    Assert-ExeVersion $OldVersion 'Old installed executable has expected version'
    Signature $exe
    $app = Launch
    Wait-Backend
    Wait-Renderer
    Assert-That ((Renderer 'window.checkbaDesktop.update.status()').appVersion -ceq $OldVersion) 'Running baseline reports exact semantic version'
    Screenshot '01-old-workbench'
    $marker = 'WINDOWS_UPGRADE_' + [guid]::NewGuid().ToString('N')
    $fixtureDir = Join-Path $env:RUNNER_TEMP 'upgrade-project'
    New-Item -ItemType Directory -Path $fixtureDir | Out-Null
    $fixture = Join-Path $fixtureDir 'retained-document.txt'
    [IO.File]::WriteAllText($fixture, $marker, [Text.UTF8Encoding]::new($false))
    $project = (Api '/projects/open-local' @{ localRoot = $fixtureDir; name = $marker }).data
    $projectId = $project.projectId
    Assert-That ($projectId -gt 0) 'Old backend persisted real local-folder project'
    $oldFiles = Api "/projects/$projectId/files"
    Assert-That (@($oldFiles | Where-Object name -eq 'retained-document.txt').Count -eq 1) 'Old backend indexed fixture document'
    $fileId = ($oldFiles | Where-Object name -eq 'retained-document.txt').id
    $hash = (Get-FileHash -LiteralPath $fixture).Hash
    $stored = Renderer "localStorage.setItem('awd-upgrade-fixture', '$marker'); localStorage.getItem('awd-upgrade-fixture')"
    Assert-That ($stored -eq $marker) 'Old renderer persisted test preference'
    $evidence.project = @{ id = $projectId; fileId = $fileId; marker = $marker; file = $fixture; sha256 = $hash }
    $evidence.oldProcessId = $app.Id
    if ($Mechanism -eq 'AppUpdater') {
        # Ephemeral local manifest key is solely a test fixture. Installers still require genuine
        # public Authenticode trust; this does not claim production manifest-key validation.
        $feedScript = Join-Path $OutDir 'fixture-feed.mjs'
        @'
import fs from 'node:fs'; import http from 'node:http'; import crypto from 'node:crypto';
const [installer, version, dir] = process.argv.slice(2);
const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(`${dir}/fixture-public.pem`, publicKey.export({type:'spki',format:'pem'}));
const hash = crypto.createHash('sha256'); for await (const b of fs.createReadStream(installer)) hash.update(b);
const major = version.split('.').slice(0,2).join('.');
const manifest = Buffer.from(JSON.stringify({schema:1,latestMajor:major,channels:{[major]:{latest:version,installers:{win32:{version,size:fs.statSync(installer).size,sha256:hash.digest('hex'),urls:['http://127.0.0.1:19568/installer.exe']}}}}}));
const signature = crypto.sign(null, manifest, privateKey).toString('base64');
http.createServer((req,res)=>{
 if(req.url === '/manifest.json') res.end(manifest);
 else if(req.url === '/manifest.json.sig') res.end(signature);
 else if(req.url === '/installer.exe') {res.setHeader('Content-Length',fs.statSync(installer).size); fs.createReadStream(installer).pipe(res);}
 else res.writeHead(404).end();
}).listen(19568,'127.0.0.1',()=>fs.writeFileSync(`${dir}/feed-ready`, 'ready'));
'@ | Set-Content -LiteralPath $feedScript -Encoding utf8
        $feed = Start-Process node -ArgumentList @("`"$feedScript`"", "`"$CandidateInstaller`"", $CandidateVersion, "`"$OutDir`"") -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $OutDir 'feed.stderr.log')
        Wait-Until { Test-Path (Join-Path $OutDir 'feed-ready') } 'local signed feed ready' 60
        # The public key override is read at check time, but process env is inherited at startup.
        Close-App $app
        Assert-That ($app.WaitForExit(120000)) 'Baseline exits cleanly before updater scenario'
        $env:CHECKBA_UPDATE_PUBKEY_FILE = Join-Path $OutDir 'fixture-public.pem'
        $app = Launch
        Wait-Backend
        Wait-Renderer
        $state = Renderer 'window.checkbaDesktop.update.check()'
        $state | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $OutDir 'prepared-update.json')
        Assert-That ($state.phase -eq 'ready' -and $state.available.kind -eq 'installer' -and $state.available.version -eq $CandidateVersion) 'Real baseline updater downloaded, hashed and prepared signed candidate'
        Screenshot '02-update-ready'
        if ($ExitMode -eq 'Restart') {
            # Obtain the CDP acknowledgment before the IPC closes this renderer. The following
            # lock/process/version gates, not this scheduling acknowledgment, prove completion.
            Start-ExitDialogDriver $app
            Assert-That ((Renderer 'setTimeout(() => window.checkbaDesktop.update.restart(), 250); true') -eq $true) 'Scheduled real update restart'
        } else { Close-App $app }
    } else {
        # Released 0.65.0 cannot prepare a full update itself. Execute the unchanged candidate
        # helper against its actual installation, and label this narrower evidence explicitly.
        New-Item -ItemType Directory -Force -Path (Split-Path $lock) | Out-Null
        $helper = Join-Path (Split-Path $lock) 'install-update.ps1'
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../main/services/install-update.ps1') -Destination $helper
        $job = @{ parentPid = $app.Id; installer = $CandidateInstaller; executable = $exe; restart = ($ExitMode -eq 'Restart'); sha256 = (Get-FileHash -LiteralPath $CandidateInstaller).Hash.ToLowerInvariant() }
        [IO.File]::WriteAllText(($lock + '.job'), (ConvertTo-Json $job), [Text.UTF8Encoding]::new($false))
        $evidence.helperSha256 = (Get-FileHash -LiteralPath $helper).Hash
        # Match production full-update.js: Windows PowerShell must not inherit PS7 module paths.
        $oldModulePath = $env:PSModulePath
        try {
            Remove-Item Env:PSModulePath -ErrorAction SilentlyContinue
            $helperStartedAt = [DateTimeOffset]::UtcNow
            $evidence.helperStartedAt = $helperStartedAt.ToString('o')
            $helperProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',"`"$helper`"","`"$lock`"") -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $OutDir 'helper.stdout.log') -RedirectStandardError (Join-Path $OutDir 'helper.stderr.log')
        } finally { $env:PSModulePath = $oldModulePath }
        Wait-Until {
            $helperProcess.Refresh()
            if ($helperProcess.HasExited) { throw "Helper exited before handshake: $($helperProcess.ExitCode); stderr: $(Get-Content (Join-Path $OutDir 'helper.stderr.log') -Raw)" }
            return Test-Path -LiteralPath $lock
        } 'real helper handshake' 60
        $evidence.helperHandshakeMs = ([DateTimeOffset]::UtcNow - $helperStartedAt).TotalMilliseconds
        Write-Host "Actual helper startup and handshake: $($evidence.helperHandshakeMs) ms"
        Assert-ExeVersion $OldVersion 'Helper waits for live parent before replacing app'
        Close-App $app
    }
    Wait-Until {
        $record = Read-UpgradeTestLock -Path $lock -AllowLegacyJob:($Mechanism -eq 'LegacyHelper')
        if ($null -eq $record) { return $false }
        $script:evidence.helperProcessId = $record.helperPid
        return $true
    } 'complete live installer lock observed' 120
    Assert-That ($app.WaitForExit(120000)) 'Old real application exits before installation'
    if ($ExitMode -eq 'Reopen') {
        $fast = Launch
        Assert-That ($fast.WaitForExit(30000)) 'Manual reopen exits while installation owns lock'
        Assert-That (Test-Path -LiteralPath ($lock + '.launch')) 'Manual reopen requests launch after install'
        Assert-That (@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -like '*com.checkba.CheckbaApplication*' }).Count -eq 0) 'No second backend starts during installation'
    }
    Wait-Until { -not (Test-Path -LiteralPath $lock) } 'real NSIS/helper finishes' 600
    if (Test-Path -LiteralPath ($lock + '.error')) { throw (Get-Content -LiteralPath ($lock + '.error') -Raw) }
    Assert-ExeVersion $CandidateVersion 'Candidate executable replaced old version'
    Signature $exe
    if ($ExitMode -eq 'Quit') {
        Start-Sleep -Seconds 3
        Assert-That (@(Get-Process -Name 'AI WorkDeck' -ErrorAction SilentlyContinue).Count -eq 0) 'Ordinary quit does not relaunch client'
        $app = Launch
    }
    Wait-Backend
    # The production helper intentionally relaunches without test CDP flags. A real HTTP read
    # verifies persisted data; the visible native window is additionally captured below.
    $projects = Api '/projects/my'
    Assert-That (@($projects | Where-Object { $_.id -eq $projectId -and $_.name -eq $marker }).Count -eq 1) 'New backend reopens the same persisted project ID and name'
    $files = Api "/projects/$projectId/files"
    Assert-That (@($files | Where-Object { $_.id -eq $fileId -and $_.name -eq 'retained-document.txt' }).Count -eq 1) 'New backend preserves file ID and metadata'
    Assert-That ((Get-FileHash -LiteralPath $fixture).Hash -eq $hash) 'Document bytes survive real NSIS upgrade'
    Wait-Until { @(Get-Process -Name 'AI WorkDeck' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle }).Count -gt 0 } 'new native workbench visible' 120
    Start-Sleep -Seconds 3
    Screenshot '03-upgraded-workbench'
    $evidence.processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'AI WorkDeck.exe' -or ($_.Name -eq 'java.exe' -and $_.CommandLine -like '*com.checkba.CheckbaApplication*') } | Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine)
    # Explicit second normal restart verifies Chromium preference persistence in the installed app.
    $current = Get-Process -Name 'AI WorkDeck' | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    Close-App $current
    Assert-That ($current.WaitForExit(120000)) 'Upgraded app closes normally'
    $app = Launch
    Wait-Backend
    Wait-Renderer
    Assert-That ((Renderer 'window.checkbaDesktop.update.status()').appVersion -eq $CandidateVersion) 'Reopened renderer belongs to running candidate executable'
    Assert-That ((Renderer "localStorage.getItem('awd-upgrade-fixture')") -eq $marker) 'Renderer preference survives install and subsequent restart'
    Screenshot '04-reopened-workbench'
    foreach ($driver in $exitDrivers) {
        Assert-That ($driver.process.WaitForExit(1000)) 'Native exit-dialog driver completed'
        $record = Get-Content -LiteralPath $driver.record -Raw | ConvertFrom-Json
        Assert-That ($driver.process.ExitCode -eq 0 -and $record.status -in @('invoked', 'exited-without-dialog')) 'Native exit-dialog driver completed without bypass'
    }
    $evidence.result = 'PASS'
} catch {
    $evidence.result = 'FAIL'
    $evidence.error = $_.Exception.Message
    Screenshot 'failure'
    throw
} finally {
    $evidence | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $OutDir 'evidence.json') -Encoding utf8
    if (Test-Path (Join-Path $dataDir 'logs')) { Copy-Item (Join-Path $dataDir 'logs') (Join-Path $OutDir 'app-logs') -Recurse -Force }
    $evidence.processDiagnostics = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('AI WorkDeck.exe', 'powershell.exe', 'pwsh.exe') } | Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine)
    if ($null -ne $helperProcess) { $helperProcess.Refresh(); $evidence.helperState = @{ id = $helperProcess.Id; hasExited = $helperProcess.HasExited; exitCode = $(if ($helperProcess.HasExited) { $helperProcess.ExitCode } else { $null }) } }
    $evidence | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $OutDir 'evidence.json') -Encoding utf8
    # Keep only the synthetic helper's small diagnostics, never the installer or user database.
    $installerDir = Split-Path $lock
    if (Test-Path -LiteralPath $installerDir) {
        $diagnostics = Join-Path $OutDir 'installer-diagnostics'
        New-Item -ItemType Directory -Force -Path $diagnostics | Out-Null
        foreach ($name in @('install-update.ps1', 'installing.json', 'installing.json.job', 'installing.json.error', 'installing.json.tmp', 'installing.json.launch', 'installing.json.stderr.log')) {
            $file = Join-Path $installerDir $name
            if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination $diagnostics }
        }
    }
    if ($null -ne $feed -and -not $feed.HasExited) { Stop-Process -Id $feed.Id -Force }
    # Disposable runner teardown only. Never copy H2 data, browser storage or any user credentials.
    Get-Process -Name 'AI WorkDeck' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
