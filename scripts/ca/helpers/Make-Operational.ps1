#Requires -Version 5.1
<#
  Mark Code Agent operational for daily use (read-only coding pilot).
  - Verifies Ollama + model + app files
  - Optional: point file browser at a real git checkout (short path)
  - Optional: Start Menu Startup entry so agent can be launched at login
  - Writes C:\runcalc\agent\config\operational.json
#>
param(
  [string]$AgentRoot = "C:\runcalc\agent",
  [string]$RepoPath = "",
  [switch]$AddStartup,
  [switch]$Launch
)

$ErrorActionPreference = "Stop"

function Info($m) { Write-Host "  $m" }
function Fail($m) { Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }

Write-Host "Code Agent — make operational" -ForegroundColor Green

$app = Join-Path $AgentRoot "app"
$server = Join-Path $app "ui\server.mjs"
$run = Join-Path $AgentRoot "run.ps1"
$cfgDir = Join-Path $AgentRoot "config"
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null

if (-not (Test-Path -LiteralPath $server)) {
  Fail "Missing $server — install/setup incomplete"
}
if (-not (Test-Path -LiteralPath $run)) {
  Fail "Missing $run — run SETUP or Repick-Model first"
}

# PATH
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
foreach ($p in @("$env:ProgramFiles\nodejs", "$env:LOCALAPPDATA\Programs\Ollama", "$env:ProgramFiles\Ollama")) {
  if (Test-Path $p) { $env:Path = "$p;$env:Path" }
}

if (-not (Get-Command node -EA SilentlyContinue)) { Fail "node not on PATH" }
if (-not (Get-Command ollama -EA SilentlyContinue)) { Fail "ollama not on PATH" }

Info "Starting Ollama if needed..."
try {
  Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 3 | Out-Null
} catch {
  Start-Process ollama -ArgumentList serve -WindowStyle Hidden
  Start-Sleep 3
}
try {
  $tags = Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 5
  Info "Ollama API OK"
} catch {
  Fail "Ollama API not reachable on 127.0.0.1:11434"
}

$model = $null
if (Test-Path (Join-Path $cfgDir "model-choice.json")) {
  try {
    $mc = Get-Content (Join-Path $cfgDir "model-choice.json") -Raw | ConvertFrom-Json
    $model = $mc.Model
  } catch { }
}
if (-not $model) {
  # parse from run.ps1
  $line = Select-String -Path $run -Pattern 'model\s*=\s*''([^'']+)''' | Select-Object -First 1
  if ($line) { $model = $line.Matches[0].Groups[1].Value }
}
if (-not $model) { $model = "qwen2.5-coder:3b" }
Info "Model: $model"

# Ensure model present
$list = & ollama list 2>$null | Out-String
if ($list -notmatch [regex]::Escape($model.Split(':')[0])) {
  Info "Pulling $model ..."
  & ollama pull $model
  if ($LASTEXITCODE -ne 0) { Fail "ollama pull failed" }
} else {
  Info "Model present in ollama list"
}

# Repo path for file browser
if (-not $RepoPath) {
  foreach ($c in @("C:\src\prc", "C:\runcalc\prc", "C:\runcalc\ca-src", $app)) {
    if (Test-Path (Join-Path $c "package.json")) { $RepoPath = $c; break }
  }
}
if (-not $RepoPath) { $RepoPath = $app }
Info "Repo/context path: $RepoPath"

# Rewrite run.ps1 with RUNCALC_REPO
$lines = @(
  '$ErrorActionPreference = ''Stop'''
  "`$app = '$app'"
  "`$model = '$model'"
  "`$repo = '$RepoPath'"
  '$port = 7843'
  '$env:Path = [Environment]::GetEnvironmentVariable(''Path'',''Machine'') + '';'' + [Environment]::GetEnvironmentVariable(''Path'',''User'')'
  'foreach ($p in @((Join-Path $env:ProgramFiles ''nodejs''), (Join-Path $env:LOCALAPPDATA ''Programs\Ollama''), (Join-Path $env:ProgramFiles ''Ollama''))) { if (Test-Path $p) { $env:Path = "$p;$env:Path" } }'
  '$env:RUNCALC_REPO = $repo'
  'try { Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 2 | Out-Null } catch { Start-Process ollama -ArgumentList serve -WindowStyle Hidden; Start-Sleep 2 }'
  '$server = Join-Path $app ''ui\server.mjs'''
  'if (-not (Get-Command node -EA SilentlyContinue)) { Write-Error ''node missing''; exit 1 }'
  # free port if stale
  '$existing = Get-NetTCPConnection -LocalPort $port -State Listen -EA SilentlyContinue | Select-Object -First 1'
  'if ($existing) { try { Stop-Process -Id $existing.OwningProcess -Force -EA SilentlyContinue } catch {} ; Start-Sleep 1 }'
  '$proc = Start-Process node -ArgumentList @($server, ''--port'', "$port", ''--model'', $model) -WorkingDirectory $app -WindowStyle Minimized -PassThru'
  'Start-Sleep 2'
  'Start-Process "http://127.0.0.1:$port/"'
  'Write-Host "OPERATIONAL model=$model repo=$repo pid=$($proc.Id)"'
)
$lines | Set-Content -LiteralPath $run -Encoding UTF8
Info "Updated $run"

# Shortcuts refresh
$icon = Join-Path $app "ui\icons\coding-assistant.ico"
$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$run`""
$sh = New-Object -ComObject WScript.Shell
foreach ($link in @(
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "CodeAgent.lnk"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\CodeAgent.lnk")
)) {
  $sc = $sh.CreateShortcut($link)
  $sc.TargetPath = $psExe
  $sc.Arguments = $arg
  $sc.WorkingDirectory = $AgentRoot
  if (Test-Path $icon) { $sc.IconLocation = "$icon,0" }
  $sc.Description = "Code Agent (operational)"
  $sc.Save()
}
Info "Shortcuts refreshed"

if ($AddStartup) {
  $startup = [Environment]::GetFolderPath("Startup")
  $sc = $sh.CreateShortcut((Join-Path $startup "CodeAgent.lnk"))
  $sc.TargetPath = $psExe
  $sc.Arguments = $arg
  $sc.WorkingDirectory = $AgentRoot
  if (Test-Path $icon) { $sc.IconLocation = "$icon,0" }
  $sc.Save()
  Info "Added to Startup folder (launches at login)"
}

$status = [ordered]@{
  operational = $true
  mode = "read-only-chat"
  model = $model
  repoPath = $RepoPath
  agentRoot = $AgentRoot
  policyNote = "Write/shell tools still disabled. Speed-first model policy for testing."
  markedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
}
$status | ConvertTo-Json | Set-Content (Join-Path $cfgDir "operational.json") -Encoding UTF8
Info "Wrote config\operational.json"

Write-Host ""
Write-Host "OPERATIONAL (read-only coding chat)" -ForegroundColor Green
Write-Host "  Desktop: CodeAgent"
Write-Host "  URL:     http://127.0.0.1:7843/"
Write-Host "  Model:   $model"
Write-Host "  Context: $RepoPath"
Write-Host ""
Write-Host "Still out of scope until you ask: file edits, shell, GitHub PRs, plant data."

if ($Launch) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $run
}
