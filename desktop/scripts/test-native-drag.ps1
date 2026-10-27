# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Signed installed Electron -> real user32 mouse gesture -> STA WinForms CF_HDROP receiver.
# CDP only reads DOM bounds/state. Never call startDrag, dispatchEvent, DOM click or AX actions.
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$OutDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) { throw 'Only disposable Windows Actions runners are supported.' }
$dataDir = Join-Path $env:USERPROFILE '.aiworkdeck'
if (Test-Path -LiteralPath $dataDir) { throw 'Refusing existing application data.' }
if (@(Get-Process -Name 'AI WorkDeck' -ErrorAction SilentlyContinue).Count) { throw 'Refusing existing client processes.' }
$Installer = (Resolve-Path -LiteralPath $Installer).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
$evidence = [ordered]@{ version = $Version; assertions = @(); gestures = @(); signatures = @(); versions = @(); result = 'NOT_RUN' }
$receiver = $null
$app = $null
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class DragInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint f, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint f);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  public struct POINT { public int x, y; }
}
'@
[DragInput]::SetProcessDPIAware() | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$screen = [Windows.Forms.Screen]::PrimaryScreen.Bounds
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
function Wait-Until([scriptblock]$Check, [string]$Label, [int]$Seconds = 120) {
    $end = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $end) { if (& $Check) { return }; Start-Sleep -Milliseconds 250 }
    throw "Timed out: $Label"
}
function Screenshot([string]$Name) {
    $bmp = New-Object Drawing.Bitmap($screen.Width, $screen.Height)
    $g = [Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($screen.Location, [Drawing.Point]::Empty, $screen.Size); $bmp.Save((Join-Path $OutDir "$Name.png")) }
    finally { $g.Dispose(); $bmp.Dispose() }
}
function Signature([string]$Path) {
    $s = Get-AuthenticodeSignature -LiteralPath $Path
    Assert-That ($s.Status -eq 'Valid' -and $null -ne $s.TimeStamperCertificate) 'Genuine Authenticode signature and timestamp are valid'
    Assert-That ($s.SignerCertificate.Subject -match 'Zhen Shan Mei Grace Legacy US Limited') 'Expected application publisher'
    $script:evidence.signatures += @{ path = $Path; sha256 = (Get-FileHash -LiteralPath $Path).Hash; publisher = $s.SignerCertificate.Subject; thumbprint = $s.SignerCertificate.Thumbprint; timestamp = $s.TimeStamperCertificate.Subject }
}
$cdp = @'
const [expression] = process.argv.slice(1);
const targets = await (await fetch('http://127.0.0.1:19577/json/list')).json();
const target = targets.find(t=>t.type==='page' && /index\.html/.test(t.url));
if(!target) throw Error('Installed workbench not found');
const ws = new WebSocket(target.webSocketDebuggerUrl); let replied=false;
const timer=setTimeout(()=>{console.error('CDP read timed out');process.exit(1)},15000);
ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));
ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id!==1)return;replied=true;
 if(r.error||r.result?.exceptionDetails){console.error(JSON.stringify(r));process.exitCode=1}
 else console.log(JSON.stringify(r.result.result.value));clearTimeout(timer);ws.close();};
ws.onerror=()=>process.exit(1);ws.onclose=()=>{if(!replied)process.exit(1)};
'@
function Read-Dom([string]$Expression) {
    $result = & node --input-type=module -e $cdp $Expression
    if ($LASTEXITCODE -ne 0) { throw 'Installed renderer read failed.' }
    return $result | ConvertFrom-Json
}
function Element([string]$Selector) {
    $json = ConvertTo-Json -Compress -InputObject $Selector
    return Read-Dom "(() => {const el=document.querySelector($json); if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,text:el.textContent,viewportWidth:innerWidth,viewportHeight:innerHeight};})()"
}
function Screen-Point($Bounds) {
    Assert-That ($null -ne $Bounds -and $Bounds.width -gt 0 -and $Bounds.height -gt 0) 'Target DOM element is rendered'
    $p = New-Object DragInput+POINT
    $p.x = [int]($Bounds.x + [math]::Min(90, $Bounds.width / 2))
    $p.y = [int]($Bounds.y + $Bounds.height / 2)
    Assert-That ($p.x -ge 0 -and $p.y -ge 0 -and $p.x -lt $Bounds.viewportWidth -and $p.y -lt $Bounds.viewportHeight) 'Gesture source is inside viewport'
    [DragInput]::ClientToScreen($app.MainWindowHandle, [ref]$p) | Out-Null
    return $p
}
function Assert-Uncovered($Point, [IntPtr]$Window) {
    Assert-That ([DragInput]::GetAncestor([DragInput]::WindowFromPoint($Point), 2) -eq $Window) 'Physical input target belongs to expected native window'
}
function Click-Element([string]$Selector) {
    [DragInput]::SetForegroundWindow($app.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 150
    $pt = Screen-Point (Element $Selector)
    Assert-Uncovered $pt $app.MainWindowHandle
    [DragInput]::SetCursorPos($pt.x, $pt.y) | Out-Null
    Start-Sleep -Milliseconds 120
    [DragInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 70
    [DragInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 250
}
function Move-Absolute([int]$X,[int]$Y) {
    $nx = [uint32][math]::Round(($X - $screen.X) * 65535 / ($screen.Width - 1))
    $ny = [uint32][math]::Round(($Y - $screen.Y) * 65535 / ($screen.Height - 1))
    [DragInput]::mouse_event(0x8001,$nx,$ny,0,[UIntPtr]::Zero)
}
function Drag-Element([string]$Selector,[int]$Sequence,[string]$ExpectedName,[string]$ExpectedHash) {
    [DragInput]::SetForegroundWindow($app.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 200
    $source = Screen-Point (Element $Selector)
    $dest = New-Object DragInput+POINT
    $dest.x = $receiverInfo.x; $dest.y = $receiverInfo.y
    Assert-Uncovered $source $app.MainWindowHandle
    Assert-Uncovered $dest ([IntPtr]$receiverInfo.handle)
    Move-Absolute $source.x $source.y
    # Actual hover primes the file-tree path cache; no direct host call or component mutation.
    Start-Sleep -Milliseconds 1200
    [DragInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    try {
        Start-Sleep -Milliseconds 150
        for ($step=1; $step -le 30; $step++) {
            Move-Absolute ([int]($source.x+($dest.x-$source.x)*$step/30)) ([int]($source.y+($dest.y-$source.y)*$step/30))
            Start-Sleep -Milliseconds 40
        }
        Start-Sleep -Milliseconds 400
        Screenshot "drag-$Sequence-held"
    } finally { [DragInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
    $receipt = Join-Path $OutDir "received-$Sequence.json"
    Wait-Until { Test-Path -LiteralPath $receipt } "real CF_HDROP receipt $Sequence" 30
    $drop = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
    Assert-That ($drop.fileDrop -eq $true -and @($drop.files).Count -eq 1) 'Native receiver obtained exactly one CF_HDROP file'
    Assert-That ($drop.files[0].name -eq $ExpectedName -and $drop.files[0].sha256 -eq $ExpectedHash) 'Received name and copied bytes match fixture'
    # Read the source again after the native drag loop returns, as mail clients may do.
    Start-Sleep -Milliseconds 500
    Assert-That ((Get-FileHash -LiteralPath $drop.files[0].source).Hash -eq $ExpectedHash) 'Dropped source still exists with correct bytes after drag completion'
    $script:evidence.gestures += @{ sequence=$Sequence; selector=$Selector; source=@{x=$source.x;y=$source.y}; destination=@{x=$dest.x;y=$dest.y}; receipt=$drop }
    Screenshot "drag-$Sequence-completed"
}
function Assert-ClicksStillWork([string]$FileId) {
    $selector = ".tree-item[data-file-id='$FileId']"
    Click-Element $selector
    $selectorJson = ConvertTo-Json -Compress -InputObject $selector
    Wait-Until { (Read-Dom "!!document.querySelector($selectorJson)?.classList.contains('tree-item-selected')") -eq $true } 'physical click changes file-tree selection after drag' 15
    Wait-Until { (Read-Dom "[...document.querySelectorAll('.tab-item.active .tab-name')].some(e=>e.textContent==='after-drag.txt')") -eq $true } 'physical click opens recovery file after drag' 20
    Click-Element '.tab-item.active .tab-close'
    Wait-Until { (Read-Dom "![...document.querySelectorAll('.tab-name')].some(e=>e.textContent==='after-drag.txt')") -eq $true } 'physical close-button click works after drag' 15
}
try {
    $inputDesktop = [DragInput]::OpenInputDesktop(0,$false,0x0100)
    Assert-That ($inputDesktop -ne [IntPtr]::Zero) 'Runner has an accessible interactive input desktop'
    [DragInput]::CloseDesktop($inputDesktop) | Out-Null
    Assert-That ($screen.Width -ge 1024 -and $screen.Height -ge 720) 'Runner desktop is large enough for two native windows'
    Signature $Installer
    $installDir = Join-Path $env:RUNNER_TEMP ('AI WorkDeck native drag '+[guid]::NewGuid().ToString('N'))
    $exe = Join-Path $installDir 'AI WorkDeck.exe'
    $installed = Start-Process $Installer -ArgumentList "/S /D=`"$installDir`"" -PassThru
    Assert-That ($installed.WaitForExit(300000)) 'Actual NSIS completed'
    $installed.Refresh()
    Assert-That ($installed.ExitCode -eq 0) 'Actual NSIS exit code zero'
    Assert-ExeVersion $Version 'Installed executable version matches candidate'
    Signature $exe
    $fixtureDir = Join-Path $env:RUNNER_TEMP 'Native drag fixture'
    $zipDir = Join-Path $env:RUNNER_TEMP 'Native drag zip source'
    New-Item -ItemType Directory -Path $fixtureDir,$zipDir | Out-Null
    $ordinary = Join-Path $fixtureDir 'ordinary-drag.txt'
    $entry = Join-Path $zipDir 'archive-entry.txt'
    $recovery = Join-Path $fixtureDir 'after-drag.txt'
    foreach ($pair in @(@($ordinary,'ORDINARY_NATIVE_DROP_1367'),@($entry,'ARCHIVE_NATIVE_DROP_1367'),@($recovery,'POST_DRAG_CLICK_1367'))) {
        [IO.File]::WriteAllText($pair[0],$pair[1],[Text.UTF8Encoding]::new($false))
    }
    Compress-Archive -LiteralPath $entry -DestinationPath (Join-Path $fixtureDir 'drag-fixture.zip')
    $env:CHECKBA_BACKEND_PORT='19576'
    $env:CHECKBA_UPDATE_MANIFEST_URL='http://127.0.0.1:19578/no-production-updates'
    $app = Start-Process $exe -ArgumentList @('--remote-debugging-port=19577',"`"$fixtureDir`"") -PassThru
    Wait-Until { try { return $null -ne (Read-Dom 'document.querySelector(".page-project-overview") ? true : null') } catch { return $false } } 'real installed workbench loads' 240
    Assert-That ((Read-Dom 'window.checkbaDesktop.update.status()').appVersion -ceq $Version) 'Running candidate reports exact semantic version'
    $app.Refresh()
    Assert-That ($app.MainWindowHandle -ne [IntPtr]::Zero) 'Installed app has a native window'
    [DragInput]::SetWindowPos($app.MainWindowHandle,[IntPtr]::Zero,$screen.X,$screen.Y,$screen.Width,$screen.Height-40,0x0040) | Out-Null
    Assert-That ((Read-Dom 'window.devicePixelRatio') -eq 1) '100 percent DPI required for physical coordinate verification'
    $api='http://127.0.0.1:19576/api'
    Wait-Until { try { return @((Invoke-RestMethod "$api/projects/my") | Where-Object name -eq 'Native drag fixture').Count -eq 1 } catch { return $false } } 'real OS open-folder request creates project' 120
    $project = @((Invoke-RestMethod "$api/projects/my") | Where-Object name -eq 'Native drag fixture')[0]
    $files = Invoke-RestMethod "$api/projects/$($project.id)/files"
    $ordinaryId = ($files | Where-Object name -eq 'ordinary-drag.txt').id
    $archiveId = ($files | Where-Object name -eq 'drag-fixture.zip').id
    $recoveryId = ($files | Where-Object name -eq 'after-drag.txt').id
    Assert-That ($ordinaryId -gt 0 -and $archiveId -gt 0 -and $recoveryId -gt 0) 'Real backend indexed all synthetic fixtures'
    Wait-Until { $null -ne (Element ".tree-item[data-file-id='$ordinaryId']") } 'project file tree is visible' 60
    # A fresh profile may show the ordinary optional-components prompt. Dismiss via the real
    # visible Later button rather than pre-seeding preferences or mutating component state.
    if ($null -ne (Element '.ocd-mask')) {
        Screenshot 'optional-components-prompt'
        Click-Element '.ocd-actions .ocd-btn:not(.primary)'
        Wait-Until { $null -eq (Element '.ocd-mask') } 'physical Later button dismisses first-launch prompt' 15
    }
    # The Windows menu must not overlap project identity or tools at the runner's narrow width.
    $header = Read-Dom @'
(() => {
 const box = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
 const items=Array.from(document.querySelectorAll('.amb-top'),el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
 return {menu:box('.amb'), items, title:box('.project-title-row'), tools:box('.header-right'), header:box('.project-header'), safeEnd:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--awd-titlebar-safe-inline-end')), width:innerWidth};
})()
'@
    $evidence.header = $header
    Assert-That ($header.menu.bottom -le $header.title.top -and $header.menu.bottom -le $header.tools.top) 'Windows menu has its own row above project and tools'
    Assert-That ($header.title.width -gt 0 -and $header.title.right -le $header.tools.left) 'Project title and tools do not overlap'
    Assert-That ($header.menu.right -le ($header.width-$header.safeEnd) -and $header.tools.right -le ($header.width-$header.safeEnd+1)) 'Menus and tools remain outside native window controls'
    for ($i=0; $i -lt $header.items.Count; $i++) {
        Assert-That ($header.items[$i].left -ge 0 -and $header.items[$i].right -le ($header.width-$header.safeEnd)) 'Every menu entry remains within the safe visible title bar'
        if ($i -gt 0) { Assert-That ($header.items[$i-1].right -le $header.items[$i].left) 'Adjacent menu entries do not overlap' }
    }
    Click-Element '.amb-top'
    Wait-Until { $null -ne (Element '.amb-menu') } 'native click opens application menu' 15
    Screenshot 'header-menu-open'
    Click-Element '.amb-top'
    Wait-Until { $null -eq (Element '.amb-menu') } 'native click closes application menu' 15
    # Separate STA message loop receives real OLE data. This process only writes this run's fixtures.
    $receiverScript = Join-Path $OutDir 'receiver.ps1'
    @'
param([string]$OutDir,[int]$X,[int]$Y)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form=New-Object Windows.Forms.Form
$form.Text='Native CF_HDROP receiver';$form.StartPosition='Manual';$form.Location=New-Object Drawing.Point($X,$Y)
$form.Size=New-Object Drawing.Size(300,200);$form.TopMost=$true;$form.AllowDrop=$true
$label=New-Object Windows.Forms.Label;$label.Text='Drop fixture files here';$label.Dock='Fill';$label.TextAlign='MiddleCenter';$label.AllowDrop=$true
$form.Controls.Add($label);$script:count=0
$onEnter={param($sender,$event) if($event.Data.GetDataPresent([Windows.Forms.DataFormats]::FileDrop)){$event.Effect=[Windows.Forms.DragDropEffects]::Copy}else{$event.Effect=[Windows.Forms.DragDropEffects]::None}}
$onDrop={param($sender,$event)
 try {
  $script:count++;$isFile=$event.Data.GetDataPresent([Windows.Forms.DataFormats]::FileDrop)
  $received=@();foreach($source in $event.Data.GetData([Windows.Forms.DataFormats]::FileDrop)){
   $target=Join-Path $OutDir ("copy-$script:count-"+[IO.Path]::GetFileName($source));Copy-Item -LiteralPath $source -Destination $target
   $received+=@{source=$source;copy=$target;name=[IO.Path]::GetFileName($source);sha256=(Get-FileHash -LiteralPath $target).Hash}
  }
  $receipt=Join-Path $OutDir "received-$script:count.json"
  @{fileDrop=$isFile;formats=@($event.Data.GetFormats());files=$received}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath ($receipt+'.tmp') -Encoding UTF8
  Move-Item -LiteralPath ($receipt+'.tmp') -Destination $receipt
  $label.Text="Received $script:count real file drops"
 } catch {$_|Out-String|Set-Content (Join-Path $OutDir 'receiver-error.txt')}
}
$form.add_DragEnter($onEnter);$label.add_DragEnter($onEnter)
$form.add_DragDrop($onDrop);$label.add_DragDrop($onDrop)
$form.add_Shown({
 $p=$form.PointToScreen((New-Object Drawing.Point(140,90)));$ready=Join-Path $OutDir 'receiver-ready.json'
 @{handle=$form.Handle.ToInt64();x=$p.X;y=$p.Y}|ConvertTo-Json|Set-Content ($ready+'.tmp')
 Move-Item -LiteralPath ($ready+'.tmp') -Destination $ready
})
[Windows.Forms.Application]::Run($form)
'@ | Set-Content -LiteralPath $receiverScript -Encoding utf8
    $oldModulePath=$env:PSModulePath
    try {
        Remove-Item Env:PSModulePath -ErrorAction SilentlyContinue
        $receiver=Start-Process powershell.exe -ArgumentList @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',"`"$receiverScript`"",'-OutDir',"`"$OutDir`"",'-X',($screen.Right-315),'-Y',($screen.Bottom-255)) -PassThru -WindowStyle Hidden
    } finally { $env:PSModulePath=$oldModulePath }
    Wait-Until { Test-Path (Join-Path $OutDir 'receiver-ready.json') } 'STA native receiver window ready' 30
    $receiverInfo=Get-Content (Join-Path $OutDir 'receiver-ready.json') -Raw|ConvertFrom-Json
    # Hidden PowerShell suppresses its console but can also hide the first WinForms window.
    # Show the actual receiver explicitly; the pointer hit-test below still requires its HWND.
    [DragInput]::ShowWindow([IntPtr]$receiverInfo.handle,5) | Out-Null
    [DragInput]::SetWindowPos([IntPtr]$receiverInfo.handle,[IntPtr](-1),0,0,0,0,0x0053) | Out-Null
    Start-Sleep -Milliseconds 250
    $evidence.appPid=$app.Id;$evidence.receiverPid=$receiver.Id;$evidence.installDir=$installDir;$evidence.dataDir=$dataDir
    Screenshot '01-ready'
    Drag-Element ".tree-item[data-file-id='$ordinaryId']" 1 'ordinary-drag.txt' ((Get-FileHash -LiteralPath $ordinary).Hash)
    Assert-ClicksStillWork "$recoveryId"
    Click-Element ".tree-item[data-file-id='$archiveId']"
    Wait-Until { $null -ne (Element '.archive-entry-row') } 'actual archive preview opens from physical file-row click' 60
    Click-Element '.archive-entry-row'
    Wait-Until { (Read-Dom '!!document.querySelector(".archive-drag-hint") && !document.querySelector(".archive-entry-preview [role=alert]")') -eq $true } 'archive byte preview finishes' 30
    # Cache write follows the preview; give the small fixture its normal asynchronous completion.
    Start-Sleep -Milliseconds 1500
    Screenshot '02-archive-ready'
    Drag-Element '.archive-entry-row' 2 'archive-entry.txt' ((Get-FileHash -LiteralPath $entry).Hash)
    Assert-ClicksStillWork "$recoveryId"
    Screenshot '03-input-recovered'
    $evidence.result='PASS'
} catch {
    $evidence.result='FAIL';$evidence.error=$_.Exception.Message
    Screenshot 'failure'
    throw
} finally {
    [DragInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    $evidence|ConvertTo-Json -Depth 15|Set-Content (Join-Path $OutDir 'evidence.json') -Encoding utf8
    if(Test-Path (Join-Path $dataDir 'logs')){Copy-Item (Join-Path $dataDir 'logs') (Join-Path $OutDir 'app-logs') -Recurse -Force}
    if($null -ne $receiver -and -not $receiver.HasExited){Stop-Process -Id $receiver.Id -Force}
    Get-Process -Name 'AI WorkDeck' -ErrorAction SilentlyContinue|Stop-Process -Force -ErrorAction SilentlyContinue
}
