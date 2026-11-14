#Requires -Version 5.1
# Short-path coding-assistant setup. Prefer CA-Setup.cmd at repo root.
[CmdletBinding()]
param(
  [string]$RepoRoot = "",
  [string]$ReportPath = "",
  [string]$AgentRoot = "C:\runcalc\agent",
  [switch]$SkipOllamaInstall,
  [switch]$SkipOpenCodeInstall,
  [switch]$SkipModelPull,
  [switch]$SkipNodeInstall,
  [switch]$UseFixture,
  [switch]$LaunchChat,
  [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Enable long paths in this process when possible
try { New-Item -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Force -ErrorAction SilentlyContinue | Out-Null } catch {}

function Step($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Info($m) { Write-Host "    $m" }
function Warn($m) { Write-Host "    WARN: $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "FAIL: $m" -ForegroundColor Red; throw $m }
function HasCmd($n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
  foreach ($p in @(
    "$env:ProgramFiles\nodejs",
    "${env:ProgramFiles(x86)}\nodejs",
    "$env:LOCALAPPDATA\Programs\Ollama",
    "$env:ProgramFiles\Ollama",
    "$env:APPDATA\npm"
  )) {
    if ($p -and (Test-Path -LiteralPath $p) -and ($env:Path -notlike "*$p*")) {
      $env:Path = "$p;$env:Path"
    }
  }
}

function Ensure-Dir($p) {
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}

function Get-Repo {
  if ($RepoRoot) {
    $c = [IO.Path]::GetFullPath($RepoRoot)
    if (-not (Test-Path -LiteralPath (Join-Path $c "package.json"))) { Fail "Bad RepoRoot: $c" }
    return $c
  }
  $guess = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
  if (Test-Path -LiteralPath (Join-Path $guess "package.json")) { return $guess }
  Fail "Pass -RepoRoot to the Production-run-calculator checkout"
}

function Winget-Install($id, $label) {
  if (-not (HasCmd "winget")) { Fail "winget missing. Install $label manually, re-run." }
  Info "winget install $label ($id)"
  & winget install --id $id -e --accept-package-agreements --accept-source-agreements --disable-interactivity
  # winget codes: 0 ok; already installed often non-zero — refresh and recheck
  Refresh-Path
}

function Ensure-Node {
  Refresh-Path
  if (HasCmd "node") { Info "Node $(node -v)"; return }
  if ($SkipNodeInstall) { Fail "Node missing and SkipNodeInstall set" }
  Step "Node.js"
  Winget-Install "OpenJS.NodeJS.LTS" "Node.js LTS"
  Refresh-Path
  if (-not (HasCmd "node")) { Fail "Node still not on PATH. Open NEW Admin PowerShell and re-run CA-Setup.cmd" }
  Info "Node $(node -v)"
}

function Ensure-Ollama {
  Refresh-Path
  if (-not (HasCmd "ollama")) {
    if ($SkipOllamaInstall) { Fail "Ollama missing and SkipOllamaInstall set" }
    Winget-Install "Ollama.Ollama" "Ollama"
    Refresh-Path
    foreach ($c in @(
      "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
      "$env:ProgramFiles\Ollama\ollama.exe"
    )) {
      if (Test-Path -LiteralPath $c) { $env:Path = "$(Split-Path $c);$env:Path"; break }
    }
  }
  if (-not (HasCmd "ollama")) { Fail "Ollama not on PATH after install" }
  Info "Ollama OK"
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 3 | Out-Null
    Info "Ollama API up"
  } catch {
    Info "Starting ollama serve..."
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 4
  }
}

function Copy-AppPayload($repo, $agentRoot) {
  # Short runtime tree: C:\runcalc\agent\app\...
  $app = Join-Path $agentRoot "app"
  Ensure-Dir $app
  Ensure-Dir (Join-Path $app "ui")
  Ensure-Dir (Join-Path $app "ui\icons")
  Ensure-Dir (Join-Path $app "bin")

  $map = @{
    "scripts\coding-assistant\bootstrap-local.mjs" = "bin\boot.mjs"
    "scripts\coding-assistant\render-opencode-config.mjs" = "bin\render.mjs"
    "scripts\coding-assistant\check-readonly-profile.mjs" = "bin\check.mjs"
    "scripts\coding-assistant\verify-pilot.mjs" = "bin\verify.mjs"
    "scripts\coding-assistant\chat-ui\server.mjs" = "ui\server.mjs"
    "scripts\coding-assistant\chat-ui\index.html" = "ui\index.html"
    "scripts\coding-assistant\chat-ui\manifest.webmanifest" = "ui\manifest.webmanifest"
    "scripts\coding-assistant\chat-ui\sw.js" = "ui\sw.js"
    "docs\coding-assistant\opencode-readonly.example.json" = "bin\profile.example.json"
    "docs\coding-assistant\fixtures\host-report-candidate-7b.json" = "bin\fixture.json"
  }
  foreach ($k in $map.Keys) {
    $src = Join-Path $repo $k
    $dst = Join-Path $app $map[$k]
    if (-not (Test-Path -LiteralPath $src)) { Fail "Missing $src" }
    Ensure-Dir (Split-Path -Parent $dst)
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
  # icons
  $iconDir = Join-Path $repo "scripts\coding-assistant\chat-ui\icons"
  if (Test-Path -LiteralPath $iconDir) {
    Copy-Item -Path (Join-Path $iconDir "*") -Destination (Join-Path $app "ui\icons") -Force
  }
  # tests folder optional for verify - verify script references repo tests; run verify from repo if present
  Info "App payload at $app"
  return $app
}

function Get-Model($jsonPath) {
  $report = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
  if ($report.schemaVersion -ne 1) { Fail "Bad schemaVersion" }
  $rec = $null
  if ($report.recommendations -and $report.recommendations.codingAssistant) {
    $rec = $report.recommendations.codingAssistant
  }
  $model = [string]$rec.modelId
  if (-not $model) { $model = [string]$rec.model }
  $allowed = @("qwen2.5-coder:7b", "qwen3-coder:30b")
  if ($allowed -notcontains $model) { Fail "Model not in catalogue: $model" }
  return $model
}

function Render-Profile($app, $report, $outFile) {
  # boot.mjs expects repo-relative structure - run from REPO with out in agent
  # Prefer repo bootstrap if available
  $repoBoot = Join-Path $script:Repo "scripts\coding-assistant\bootstrap-local.mjs"
  if (Test-Path -LiteralPath $repoBoot) {
    & node $repoBoot --report $report --out $outFile
  } else {
    Fail "bootstrap missing"
  }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outFile)) {
    Fail "Profile render failed"
  }
}

function Write-RunPs1($path, $app, $profile, $model, $repo) {
  $content = @"
`$ErrorActionPreference = 'Stop'
`$app = '$app'
`$profile = '$profile'
`$model = '$model'
`$repo = '$repo'
`$port = 7843
`$url = "http://127.0.0.1:`$port/"
`$server = Join-Path `$app 'ui\server.mjs'
`$m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
`$u = [Environment]::GetEnvironmentVariable('Path', 'User')
`$env:Path = "`$m;`$u"
`$extras = @(
  (Join-Path `$env:ProgramFiles 'nodejs'),
  (Join-Path `$env:LOCALAPPDATA 'Programs\Ollama'),
  (Join-Path `$env:ProgramFiles 'Ollama')
)
foreach (`$p in `$extras) {
  if (Test-Path -LiteralPath `$p) { `$env:Path = "`$p;`$env:Path" }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node missing. Run CA-Setup.cmd again.'
  exit 1
}
try {
  Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2 | Out-Null
} catch {
  if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    Start-Sleep -Seconds 2
  }
}
`$wd = `$repo
if (-not (Test-Path -LiteralPath (Join-Path `$wd 'package.json'))) { `$wd = `$app }
`$proc = Start-Process -FilePath 'node' -ArgumentList @(`$server, '--port', "`$port", '--model', `$model) -WorkingDirectory `$wd -WindowStyle Minimized -PassThru
Start-Sleep -Seconds 1
Start-Process `$url
Write-Host "Chat `$url  PID=`$(`$proc.Id)"
"@
  Set-Content -LiteralPath $path -Value $content -Encoding UTF8
}

function Add-Shortcut($link, $target, $args, $work, $icon) {
  $sh = New-Object -ComObject WScript.Shell
  $sc = $sh.CreateShortcut($link)
  $sc.TargetPath = $target
  $sc.Arguments = $args
  $sc.WorkingDirectory = $work
  if ($icon -and (Test-Path -LiteralPath $icon)) { $sc.IconLocation = "$icon,0" }
  $sc.Description = "Local Coding Assistant"
  $sc.Save()
  Info "Shortcut $link"
}

# --- main ---
$script:Repo = $null
Ensure-Dir $AgentRoot
Ensure-Dir (Join-Path $AgentRoot "config")
Ensure-Dir (Join-Path $AgentRoot "logs")
$log = Join-Path $AgentRoot ("logs\setup-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
try { Start-Transcript -Path $log -Force | Out-Null } catch {}

Write-Host "Coding Assistant setup (short paths)" -ForegroundColor Green
Write-Host "Agent: $AgentRoot  Log: $log" -ForegroundColor DarkGray

try {
  Step "Repo"
  $script:Repo = Get-Repo
  Info $script:Repo

  $fixture = Join-Path $script:Repo "docs\coding-assistant\fixtures\host-report-candidate-7b.json"
  if ($UseFixture -or -not $ReportPath) { $ReportPath = $fixture }
  if (-not (Test-Path -LiteralPath $ReportPath)) { Fail "Report missing: $ReportPath" }

  Step "Model id"
  $model = Get-Model $ReportPath
  Info $model

  Ensure-Node
  Step "Ollama"
  Ensure-Ollama
  if (-not $SkipModelPull) {
    Info "Pull $model (long on first run)..."
    & ollama pull $model
    if ($LASTEXITCODE -ne 0) { Fail "ollama pull failed code $LASTEXITCODE" }
  }

  if (-not $SkipOpenCodeInstall) {
    Step "OpenCode (optional)"
    Refresh-Path
    if (-not (HasCmd "opencode") -and (HasCmd "npm")) {
      try { & npm install -g opencode-ai 2>$null; Refresh-Path } catch { Warn $_.Exception.Message }
    }
    if (HasCmd "opencode") { Info "opencode OK" } else { Warn "opencode skipped — chat UI still works" }
  }

  Step "Copy app to short path"
  $app = Copy-AppPayload $script:Repo $AgentRoot

  Step "Profile"
  $profile = Join-Path $AgentRoot "config\oc.json"
  Render-Profile $app $ReportPath $profile
  Info $profile

  Step "Launcher + shortcuts"
  $runPs1 = Join-Path $AgentRoot "run.ps1"
  Write-RunPs1 $runPs1 $app $profile $model $script:Repo
  $icon = Join-Path $app "ui\icons\coding-assistant.ico"
  if (-not (Test-Path $icon)) { $icon = Join-Path $app "ui\icons\icon-32.png" }
  $ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$runPs1`""
  $prog = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  Ensure-Dir $prog
  # SHORT shortcut names only
  Add-Shortcut (Join-Path $prog "CodeAgent.lnk") $ps $arg $AgentRoot $icon
  $desk = [Environment]::GetFolderPath("Desktop")
  if ($desk) { Add-Shortcut (Join-Path $desk "CodeAgent.lnk") $ps $arg $AgentRoot $icon }

  Step "Done"
  Write-Host "Profile $profile" -ForegroundColor Green
  Write-Host "Shortcuts: Desktop\CodeAgent.lnk  and  Start Menu\CodeAgent.lnk" -ForegroundColor Green
  Write-Host "Chat payload: $app\ui" -ForegroundColor Green

  if (-not $NoLaunch) {
    if ($LaunchChat -or -not $NoLaunch) {
      Step "Launch"
      & powershell -NoProfile -ExecutionPolicy Bypass -File $runPs1
    }
  }
}
catch {
  Write-Host "SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $log" -ForegroundColor Yellow
  if (-not $env:CA_SETUP_NONINTERACTIVE) {
    try { Read-Host "Press Enter to close" | Out-Null } catch {}
  }
  exit 1
}
finally {
  try { Stop-Transcript | Out-Null } catch {}
}
exit 0
