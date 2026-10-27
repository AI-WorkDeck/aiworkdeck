# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# CI preparation (outside the standard-user probe):
# javac -encoding UTF-8 --release 17 -cp "RESOURCES/backend/app.jar;RESOURCES/backend/lib/*" -d CLASSES RuntimeInstallProbe.java
# Invoke this script inside the existing disposable standard-user Windows child after Node MSI installation.
param(
    [Parameter(Mandatory=$true)][string]$Resources,
    [Parameter(Mandatory=$true)][string]$Repo,
    [Parameter(Mandatory=$true)][string]$Output,
    [Parameter(Mandatory=$true)][string]$ProbeClasses,
    [string]$Node = 'C:\Program Files\nodejs\node.exe'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'Windows only' }
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run the inference probe as a standard user' }
if (Test-Path -LiteralPath $Output) { throw 'Output must be a new disposable directory' }
$Resources = (Resolve-Path -LiteralPath $Resources).Path
$Repo = (Resolve-Path -LiteralPath $Repo).Path
$ProbeClasses = (Resolve-Path -LiteralPath $ProbeClasses).Path
$java = Join-Path $Resources 'jre\bin\java.exe'
$python = Join-Path $Resources 'python\python.exe'
foreach ($file in @($java,$python,$Node,(Join-Path $ProbeClasses 'RuntimeInstallProbe.class'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required installed file missing: $file" }
}
New-Item -ItemType Directory -Path $Output | Out-Null
$Output = (Resolve-Path -LiteralPath $Output).Path
foreach ($dir in @('home','appdata','localappdata','temp','cache')) {
    New-Item -ItemType Directory -Path (Join-Path $Output $dir) | Out-Null
}
function Run-Checked([string]$Exe, [string[]]$Arguments, [string]$Label, [int]$Seconds) {
    # Windows file names cannot contain quotes; these arguments are paths or fixed switches.
    $quoted = @($Arguments | ForEach-Object {
        if ($_ -match '"' -or $_.EndsWith('\')) { throw 'Unsupported quote or trailing separator in argument' }
        '"' + $_ + '"'
    }) -join ' '
    $p = Start-Process -FilePath $Exe -ArgumentList $quoted -WorkingDirectory $Output -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $Output "$Label.stdout.log") -RedirectStandardError (Join-Path $Output "$Label.stderr.log")
    # Windows PowerShell 5.1 otherwise loses ExitCode for redirected async processes.
    # https://github.com/PowerShell/PowerShell/issues/5421
    $processHandle = $p.Handle
    if (-not $p.WaitForExit($Seconds * 1000)) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $p.Id /T /F | Out-Null
        throw "$Label exceeded $Seconds seconds"
    }
    $p.WaitForExit()
    if ($null -eq $p.ExitCode) { throw "$Label returned no exit code" }
    if ($p.ExitCode -ne 0) { throw "$Label exited $($p.ExitCode); inspect $Output logs" }
}
$values = @{
    HOME=(Join-Path $Output 'home'); USERPROFILE=(Join-Path $Output 'home');
    APPDATA=(Join-Path $Output 'appdata'); LOCALAPPDATA=(Join-Path $Output 'localappdata');
    TEMP=(Join-Path $Output 'temp'); TMP=(Join-Path $Output 'temp'); TMPDIR=(Join-Path $Output 'temp');
    XDG_CACHE_HOME=(Join-Path $Output 'cache'); PYTHONDONTWRITEBYTECODE='1'; PYTHONIOENCODING='utf-8'; PYTHONNOUSERSITE='1';
    PYTHONHOME=$null; PYTHONPATH=$null; NODE_PATH=$null; NODE_OPTIONS=$null;
    HF_HOME=$null; HF_HUB_CACHE=$null; HUGGINGFACE_HUB_CACHE=$null; HF_ASSETS_CACHE=$null; TRANSFORMERS_CACHE=$null;
    HF_HUB_OFFLINE=$null; HF_ENDPOINT=$null; HF_TOKEN=$null; HUGGING_FACE_HUB_TOKEN=$null;
    ASR_MODEL=$null; ASR_MODEL_DIR=$null; ASR_DEVICE=$null; ASR_COMPUTE_TYPE=$null; ASR_BEAM_SIZE=$null; ASR_OUTPUT_SCRIPT=$null;
    KOKORO_MODEL_DIR=$null; KOKORO_MODEL=$null; KOKORO_REPO_ID=$null; CHECKBA_MODEL_SOURCE=$null; CHECKBA_HF_ENDPOINT=$null;
    MODELSCOPE_CACHE=(Join-Path $Output 'cache\modelscope');
    HTTP_PROXY=$null; HTTPS_PROXY=$null; ALL_PROXY=$null; NO_PROXY=$null;
    AIWORKDECK_PYSVC_ASR_DIR=$null; AIWORKDECK_PYSVC_KOKORO_DIR=$null
}
$previous = @{}
try {
    foreach ($key in $values.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key,'Process')
        [Environment]::SetEnvironmentVariable($key,$values[$key],'Process')
    }
    # Prove both success and failure detection before downloading the large runtimes.
    Run-Checked $python @('-c','import time; time.sleep(.2)') 'exit-code-zero' 10
    $rejected = $false
    try { Run-Checked $python @('-c','import time,sys; time.sleep(.2); sys.exit(7)') 'exit-code-seven' 10 }
    catch { if ("$_" -match 'exit-code-seven exited 7;') { $rejected = $true } else { throw } }
    if (-not $rejected) { throw 'Native exit-code failure was not detected' }
    $config = Get-Content (Join-Path $Repo 'backend\src\main\resources\application.yml') -Raw
    $keyPem = [regex]::Match($config, '(?s)-----BEGIN PUBLIC KEY-----.*?-----END PUBLIC KEY-----').Value -replace '(?m)^\s+', ''
    if (-not $keyPem) { throw 'Missing published pack verification key' }
    $keyPem | Set-Content (Join-Path $Output 'public.pem') -Encoding ascii
    $version = (Get-Content (Join-Path $Repo 'desktop\package.json') -Raw | ConvertFrom-Json).version
    @{ appVersion=$version; backendSha256=(Get-FileHash (Join-Path $Resources 'backend\app.jar') -Algorithm SHA256).Hash;
       pythonSha256=(Get-FileHash $python -Algorithm SHA256).Hash; nodeSha256=(Get-FileHash $Node -Algorithm SHA256).Hash;
       standardUser=$true; resources=$Resources; source=$Repo } |
       ConvertTo-Json | Set-Content (Join-Path $Output 'installed-inputs.json') -Encoding utf8
    Run-Checked $java @('-Dfile.encoding=UTF-8',"-Duser.home=$Output\home",'-cp',"$ProbeClasses;$Resources\backend\app.jar;$Resources\backend\lib\*",'RuntimeInstallProbe',$Output,"$Output\public.pem",$version) 'runtime-install' 3600
    Run-Checked $Node @((Join-Path $PSScriptRoot 'model-prepare.cjs'),$Resources,$Repo,$Output) 'model-prepare' 3000
    $runtimes = Get-Content (Join-Path $Output 'runtime-install.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $asr = @($runtimes.packs | Where-Object id -eq 'asr-runtime')[0]
    $kokoro = @($runtimes.packs | Where-Object id -eq 'kokoro-runtime')[0]
    Run-Checked $python @((Join-Path $Repo 'asr-service\tests\real_inference.py'),'--python',$python,
        '--asr-lib',$asr.lib,'--asr-models',"$Output\models\asr",'--kokoro-lib',$kokoro.lib,
        '--kokoro-models',"$Output\models\kokoro",'--output',"$Output\inference") 'real-inference' 900
    Get-Content (Join-Path $Output 'inference\report.json') -Raw -Encoding UTF8
} finally {
    foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process') }
}
