#Requires -Version 5.1
param(
  [string]$BundleRoot = "",
  [string]$AgentRoot = "C:\runcalc\agent"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Step($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Warn($m) { Write-Host "    WARN: $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "FAIL: $m" -ForegroundColor Red; throw $m }
function HasCmd($n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }
function Ensure-Dir($p) { if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null } }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
  foreach ($p in @(
    "$env:ProgramFiles\nodejs",
    "$env:LOCALAPPDATA\Programs\Ollama",
    "$env:ProgramFiles\Ollama"
  )) { if (Test-Path -LiteralPath $p) { $env:Path = "$p;$env:Path" } }
}

if (-not $BundleRoot) { $BundleRoot = $PSScriptRoot }
$BundleRoot = [IO.Path]::GetFullPath($BundleRoot)
$ca = Join-Path $BundleRoot "ca"
if (-not (Test-Path (Join-Path $ca "ui\server.mjs"))) { Fail "ca\ui\server.mjs missing — extract full bundle to a SHORT path e.g. C:\runcalc\ca-src" }

Ensure-Dir $AgentRoot
Ensure-Dir (Join-Path $AgentRoot "config")
Ensure-Dir (Join-Path $AgentRoot "logs")
Ensure-Dir (Join-Path $AgentRoot "app")
$log = Join-Path $AgentRoot ("logs\setup-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
try { Start-Transcript -Path $log -Force | Out-Null } catch {}

Write-Host "Code Agent SETUP (standalone short bundle)" -ForegroundColor Green
Write-Host "Bundle $BundleRoot" -ForegroundColor DarkGray
Write-Host "Log    $log" -ForegroundColor DarkGray

try {
  Step "Node.js"
  Refresh-Path
  if (-not (HasCmd "node")) {
    if (-not (HasCmd "winget")) { Fail "Install Node.js LTS manually, then re-run" }
    Info "Installing Node LTS via winget..."
    & winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    Refresh-Path
  }
  if (-not (HasCmd "node")) { Fail "Node not on PATH — open new Admin terminal and re-run SETUP.cmd" }
  Info $(node -v)

  Step "Ollama"
  if (-not (HasCmd "ollama")) {
    if (-not (HasCmd "winget")) { Fail "Install Ollama from ollama.com, then re-run" }
    Info "Installing Ollama via winget..."
    & winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    Refresh-Path
    foreach ($c in @("$env:LOCALAPPDATA\Programs\Ollama\ollama.exe","$env:ProgramFiles\Ollama\ollama.exe")) {
      if (Test-Path $c) { $env:Path = "$(Split-Path $c);$env:Path"; break }
    }
  }
  if (-not (HasCmd "ollama")) { Fail "Ollama not on PATH after install" }
  try { Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 3 | Out-Null }
  catch { Start-Process ollama -ArgumentList serve -WindowStyle Hidden; Start-Sleep 4 }

  $model = "qwen2.5-coder:7b"
  Step "Model $model"
  & ollama pull $model
  if ($LASTEXITCODE -ne 0) { Fail "ollama pull failed" }

  Step "Copy app to C:\runcalc\agent\app"
  $app = Join-Path $AgentRoot "app"
  Ensure-Dir (Join-Path $app "ui\icons")
  Ensure-Dir (Join-Path $app "cfg")
  Copy-Item -Path (Join-Path $ca "ui\*") -Destination (Join-Path $app "ui") -Recurse -Force
  Copy-Item -Path (Join-Path $ca "cfg\*") -Destination (Join-Path $app "cfg") -Force
  Copy-Item -Path (Join-Path $ca "bin\*") -Destination (Join-Path $app "cfg") -Force -ErrorAction SilentlyContinue

  # Build a minimal OpenCode-like local config without monorepo bootstrap
  $profile = Join-Path $AgentRoot "config\oc.json"
  $example = Get-Content (Join-Path $app "cfg\profile.example.json") -Raw | ConvertFrom-Json
  # Replace placeholders with model id
  $raw = Get-Content (Join-Path $ca "cfg\profile.example.json") -Raw
  $raw = $raw.Replace("REPLACE_WITH_INSTALLED_OLLAMA_MODEL_ID", $model)
  Set-Content -LiteralPath $profile -Value $raw -Encoding UTF8
  Info "Profile $profile"

  # Patch server.mjs in app to use RUNCALC_REPO or agent app as root for file browser
  # Write launcher
  $run = Join-Path $AgentRoot "run.ps1"
  @"
`$ErrorActionPreference='Stop'
`$app='$app'
`$model='$model'
`$port=7843
`$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
foreach (`$p in @(`$env:ProgramFiles+'\nodejs', `$env:LOCALAPPDATA+'\Programs\Ollama')) { if (Test-Path `$p) { `$env:Path = "`$p;`$env:Path" } }
`$env:RUNCALC_REPO = '$app'
try { Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 2 | Out-Null } catch { Start-Process ollama -ArgumentList serve -WindowStyle Hidden; Start-Sleep 2 }
`$server = Join-Path `$app 'ui\server.mjs'
`$proc = Start-Process node -ArgumentList @(`$server,'--port',"`$port",'--model',`$model) -WorkingDirectory `$app -WindowStyle Minimized -PassThru
Start-Sleep 1
Start-Process "http://127.0.0.1:`$port/"
Write-Host "Chat http://127.0.0.1:`$port/ PID=`$(`$proc.Id)"
"@ | Set-Content $run -Encoding UTF8

  # Fix server root: when only app exists, package.json may not - create stub package.json in app for findRepoRoot
  '{"name":"ca-agent","private":true}' | Set-Content (Join-Path $app "package.json") -Encoding UTF8
  # Ensure server finds root - copy server and set findRepoRoot to prefer RUNCALC_REPO
  # Already uses RUNCALC_REPO env

  $icon = Join-Path $app "ui\icons\coding-assistant.ico"
  $ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$run`""
  $sh = New-Object -ComObject WScript.Shell
  foreach ($link in @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "CodeAgent.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\CodeAgent.lnk")
  )) {
    $sc = $sh.CreateShortcut($link)
    $sc.TargetPath = $ps
    $sc.Arguments = $arg
    $sc.WorkingDirectory = $AgentRoot
    if (Test-Path $icon) { $sc.IconLocation = "$icon,0" }
    $sc.Description = "Code Agent"
    $sc.Save()
    Info "Shortcut $link"
  }

  Step "Launch"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $run

  Write-Host ""
  Write-Host "DONE. Use Desktop\CodeAgent.lnk next time." -ForegroundColor Green
  Write-Host "Log: $log"
}
catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $log"
  exit 1
}
finally { try { Stop-Transcript | Out-Null } catch {} }
exit 0
