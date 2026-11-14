#Requires -Version 5.1
param(
  [string]$BundleRoot = "",
  [string]$AgentRoot = "C:\runcalc\agent"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Step([string]$m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Info([string]$m) { Write-Host "    $m" }
function Fail([string]$m) { Write-Host "FAIL: $m" -ForegroundColor Red; throw $m }
function HasCmd([string]$n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }
function Ensure-Dir([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
  }
}
function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
  foreach ($p in @(
      "$env:ProgramFiles\nodejs",
      "$env:LOCALAPPDATA\Programs\Ollama",
      "$env:ProgramFiles\Ollama"
    )) {
    if ($p -and (Test-Path -LiteralPath $p)) {
      $env:Path = "$p;$env:Path"
    }
  }
}

if (-not $BundleRoot) { $BundleRoot = $PSScriptRoot }
$BundleRoot = [System.IO.Path]::GetFullPath($BundleRoot)
$ca = Join-Path $BundleRoot "ca"
$serverSrc = Join-Path $ca "ui\server.mjs"
if (-not (Test-Path -LiteralPath $serverSrc)) {
  Fail "ca\ui\server.mjs missing. Extract the FULL zip to a SHORT path, e.g. C:\runcalc\ca-src"
}

Ensure-Dir $AgentRoot
Ensure-Dir (Join-Path $AgentRoot "config")
Ensure-Dir (Join-Path $AgentRoot "logs")
Ensure-Dir (Join-Path $AgentRoot "app")

$log = Join-Path $AgentRoot ("logs\setup-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
try { Start-Transcript -Path $log -Force | Out-Null } catch { }

Write-Host "Code Agent SETUP (standalone short bundle)" -ForegroundColor Green
Write-Host "Bundle $BundleRoot" -ForegroundColor DarkGray
Write-Host "Log    $log" -ForegroundColor DarkGray

try {
  Step "Node.js"
  Refresh-Path
  if (-not (HasCmd "node")) {
    if (-not (HasCmd "winget")) { Fail "Install Node.js LTS from https://nodejs.org then re-run SETUP.cmd" }
    Info "Installing Node LTS via winget..."
    & winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    Refresh-Path
  }
  if (-not (HasCmd "node")) {
    Fail "Node not on PATH. Close this window, open a NEW Admin PowerShell, run SETUP.cmd again."
  }
  Info ((& node -v) | Out-String).Trim()

  Step "Ollama"
  if (-not (HasCmd "ollama")) {
    if (-not (HasCmd "winget")) { Fail "Install Ollama from https://ollama.com then re-run SETUP.cmd" }
    Info "Installing Ollama via winget..."
    & winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    Refresh-Path
    foreach ($c in @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:ProgramFiles\Ollama\ollama.exe"
      )) {
      if (Test-Path -LiteralPath $c) {
        $env:Path = "$(Split-Path $c);$env:Path"
        break
      }
    }
  }
  if (-not (HasCmd "ollama")) { Fail "Ollama not on PATH after install" }
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 3 | Out-Null
    Info "Ollama API is up"
  } catch {
    Info "Starting ollama serve..."
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 4
  }

  $model = "qwen2.5-coder:7b"
  Step "Model $model"
  Info "Pulling (first time can take a long time)..."
  & ollama pull $model
  if ($LASTEXITCODE -ne 0) { Fail "ollama pull failed with exit $LASTEXITCODE" }

  Step "Copy app to C:\runcalc\agent\app"
  $app = Join-Path $AgentRoot "app"
  Ensure-Dir (Join-Path $app "ui\icons")
  Ensure-Dir (Join-Path $app "cfg")
  Copy-Item -Path (Join-Path $ca "ui\*") -Destination (Join-Path $app "ui") -Recurse -Force
  Copy-Item -Path (Join-Path $ca "cfg\*") -Destination (Join-Path $app "cfg") -Force

  $stub = Join-Path $app "package.json"
  Set-Content -LiteralPath $stub -Value '{"name":"ca-agent","private":true}' -Encoding UTF8

  Step "Profile"
  $profile = Join-Path $AgentRoot "config\oc.json"
  $examplePath = Join-Path $ca "cfg\profile.example.json"
  if (-not (Test-Path -LiteralPath $examplePath)) { Fail "Missing $examplePath" }
  $raw = Get-Content -LiteralPath $examplePath -Raw
  $raw = $raw.Replace("REPLACE_WITH_INSTALLED_OLLAMA_MODEL_ID", $model)
  Set-Content -LiteralPath $profile -Value $raw -Encoding UTF8
  Info $profile

  Step "Launcher"
  $run = Join-Path $AgentRoot "run.ps1"
  $runLines = @(
    '$ErrorActionPreference = ''Stop'''
    "`$app = '$app'"
    "`$model = '$model'"
    '$port = 7843'
    '$env:Path = [Environment]::GetEnvironmentVariable(''Path'', ''Machine'') + '';'' + [Environment]::GetEnvironmentVariable(''Path'', ''User'')'
    'foreach ($p in @((Join-Path $env:ProgramFiles ''nodejs''), (Join-Path $env:LOCALAPPDATA ''Programs\Ollama''), (Join-Path $env:ProgramFiles ''Ollama''))) { if (Test-Path -LiteralPath $p) { $env:Path = "$p;$env:Path" } }'
    "`$env:RUNCALC_REPO = '$app'"
    'try { Invoke-WebRequest -Uri ''http://127.0.0.1:11434/api/tags'' -UseBasicParsing -TimeoutSec 2 | Out-Null } catch { if (Get-Command ollama -ErrorAction SilentlyContinue) { Start-Process -FilePath ''ollama'' -ArgumentList ''serve'' -WindowStyle Hidden; Start-Sleep -Seconds 2 } }'
    '$server = Join-Path $app ''ui\server.mjs'''
    'if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error ''Node missing. Run SETUP.cmd again.''; exit 1 }'
    '$proc = Start-Process -FilePath ''node'' -ArgumentList @($server, ''--port'', "$port", ''--model'', $model) -WorkingDirectory $app -WindowStyle Minimized -PassThru'
    'Start-Sleep -Seconds 1'
    'Start-Process "http://127.0.0.1:$port/"'
    'Write-Host "Chat http://127.0.0.1:$port/ PID=$($proc.Id)"'
  )
  Set-Content -LiteralPath $run -Value $runLines -Encoding UTF8
  Info $run

  Step "Shortcuts"
  $icon = Join-Path $app "ui\icons\coding-assistant.ico"
  $psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$run`""
  $sh = New-Object -ComObject WScript.Shell
  $links = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "CodeAgent.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\CodeAgent.lnk")
  )
  foreach ($link in $links) {
    $sc = $sh.CreateShortcut($link)
    $sc.TargetPath = $psExe
    $sc.Arguments = $arg
    $sc.WorkingDirectory = $AgentRoot
    if (Test-Path -LiteralPath $icon) { $sc.IconLocation = "$icon,0" }
    $sc.Description = "Code Agent"
    $sc.Save()
    Info $link
  }

  Step "Launch"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $run

  Write-Host ""
  Write-Host "DONE. Use Desktop\CodeAgent.lnk next time." -ForegroundColor Green
  Write-Host "Log: $log"
}
catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $log"
  if (-not $env:CA_SETUP_NONINTERACTIVE) {
    try { Read-Host "Press Enter to close" | Out-Null } catch { }
  }
  exit 1
}
finally {
  try { Stop-Transcript | Out-Null } catch { }
}
exit 0
