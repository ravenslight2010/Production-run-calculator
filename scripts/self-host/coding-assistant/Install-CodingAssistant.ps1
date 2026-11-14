#Requires -Version 5.1
<#
.SYNOPSIS
  Install the local coding-assistant pilot (Ollama + OpenCode + read-only profile).

.DESCRIPTION
  Fail-closed pilot installer for the Production Run Calculator coding assistant.
  - Creates C:\runcalc\agent (separate from plant)
  - Ensures Node.js is available for profile rendering
  - Installs Ollama (winget) when missing
  - Pulls only the catalogue model from a HostInspector report or fixture
  - Installs OpenCode when a supported path exists
  - Renders the read-only OpenCode profile

  Does NOT touch C:\runcalc\plant production data.
  Does NOT enable write/shell tools or cloud providers.

.PARAMETER RepoRoot
  Path to a git checkout of Production-run-calculator. Default: script-relative repo root when present.

.PARAMETER ReportPath
  HostInspector JSON report. If omitted, uses bundled fixture (not a host qualification).

.PARAMETER AgentRoot
  Working directory for the assistant. Default: C:\runcalc\agent

.PARAMETER SkipOllamaInstall
  Do not install Ollama; require it on PATH.

.PARAMETER SkipOpenCodeInstall
  Do not install OpenCode; require it on PATH.

.PARAMETER SkipModelPull
  Do not run ollama pull.

.PARAMETER UseFixture
  Force the bundled sample host report.
#>
[CmdletBinding()]
param(
  [string]$RepoRoot = "",
  [string]$ReportPath = "",
  [string]$AgentRoot = "C:\runcalc\agent",
  [switch]$SkipOllamaInstall,
  [switch]$SkipOpenCodeInstall,
  [switch]$SkipModelPull,
  [switch]$UseFixture
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Info([string]$Message) { Write-Host "    $Message" }
function Write-Warn2([string]$Message) { Write-Host "    WARN: $Message" -ForegroundColor Yellow }
function Fail([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-RepoRoot {
  if ($RepoRoot -and (Test-Path -LiteralPath $RepoRoot)) {
    return (Resolve-Path -LiteralPath $RepoRoot).Path
  }
  $here = $PSScriptRoot
  # scripts/self-host/coding-assistant -> repo root
  $candidate = Resolve-Path (Join-Path $here "..\..\..") -ErrorAction SilentlyContinue
  if ($candidate -and (Test-Path (Join-Path $candidate.Path "package.json"))) {
    return $candidate.Path
  }
  Fail "RepoRoot not found. Pass -RepoRoot path\to\Production-run-calculator"
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Install-OllamaIfNeeded {
  if (Test-Command "ollama") {
    Write-Info "Ollama already on PATH: $((Get-Command ollama).Source)"
    return
  }
  if ($SkipOllamaInstall) {
    Fail "Ollama not on PATH and -SkipOllamaInstall was set"
  }
  if (-not (Test-Command "winget")) {
    Fail "winget not found. Install Ollama manually from https://ollama.com then re-run."
  }
  Write-Info "Installing Ollama via winget (Ollama.Ollama)..."
  & winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements
  if (-not (Test-Command "ollama")) {
    # winget may not refresh PATH in this session
    $ollamaExe = @(
      "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
      "$env:ProgramFiles\Ollama\ollama.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($ollamaExe) {
      $env:Path = "$(Split-Path $ollamaExe);$env:Path"
    }
  }
  if (-not (Test-Command "ollama")) {
    Fail "Ollama install finished but 'ollama' is not on PATH. Open a new terminal and re-run."
  }
}

function Install-OpenCodeIfNeeded {
  if (Test-Command "opencode") {
    Write-Info "OpenCode already on PATH: $((Get-Command opencode).Source)"
    return
  }
  if ($SkipOpenCodeInstall) {
    Write-Warn2 "OpenCode not on PATH; skipping install (-SkipOpenCodeInstall)."
    return
  }
  if (Test-Command "npm") {
    Write-Info "Installing OpenCode via npm -g opencode-ai (or @opencode-ai/cli if needed)..."
    try {
      & npm install -g opencode-ai 2>$null
      if (-not (Test-Command "opencode")) {
        & npm install -g @opencode-ai/cli 2>$null
      }
    } catch {
      Write-Warn2 "npm global install failed: $($_.Exception.Message)"
    }
  }
  if (-not (Test-Command "opencode")) {
    Write-Warn2 "OpenCode not detected after install attempt."
    Write-Warn2 "Install manually from https://opencode.ai then point it at the rendered config."
  } else {
    Write-Info "OpenCode available: $((Get-Command opencode).Source)"
  }
}

function Get-ModelFromReport([string]$JsonPath) {
  if (-not (Test-Path -LiteralPath $JsonPath)) {
    Fail "Report not found: $JsonPath"
  }
  $report = Get-Content -LiteralPath $JsonPath -Raw | ConvertFrom-Json
  if ($report.schemaVersion -ne 1) { Fail "Unsupported report schemaVersion" }
  if ($report.tool -ne "RunCalculator.HostInspector") { Fail "Unexpected report tool" }
  if (-not $report.inspectionOnly) { Fail "Report is not inspection-only" }
  if ($report.overallStatus -notin @("pass", "warn")) { Fail "Host inspection blocked/unknown; refusing install" }
  $ca = $report.codingAssistant
  if (-not $ca -or $ca.status -ne "candidate") {
    Fail "No codingAssistant candidate in report (status=$($ca.status)). Refusing model pull."
  }
  if ($ca.provider -ne "ollama") { Fail "Only local Ollama provider is accepted" }
  $model = [string]$ca.candidateModel
  $allowed = @("qwen2.5-coder:7b", "qwen3-coder:30b")
  if ($allowed -notcontains $model) {
    Fail "Model '$model' is not in the approved catalogue: $($allowed -join ', ')"
  }
  return $model
}

function Invoke-ProfileRender([string]$Repo, [string]$Report, [string]$OutFile) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Fail "Node.js is required to render the OpenCode profile. Install Node 24+ and re-run."
  }
  $bootstrap = Join-Path $Repo "scripts\coding-assistant\bootstrap-local.mjs"
  if (-not (Test-Path -LiteralPath $bootstrap)) {
    Fail "Missing bootstrap script at $bootstrap"
  }
  Write-Info "Rendering read-only profile -> $OutFile"
  & node $bootstrap --report $Report --out $OutFile
  if ($LASTEXITCODE -ne 0) {
    Fail "Profile render failed (exit $LASTEXITCODE)"
  }
  if (-not (Test-Path -LiteralPath $OutFile)) {
    Fail "Expected profile not written: $OutFile"
  }
}


function New-CodingAssistantShortcut(
  [string]$LinkPath,
  [string]$TargetPath,
  [string]$Arguments,
  [string]$WorkDir,
  [string]$IconPath,
  [string]$Description
) {
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($LinkPath)
  $sc.TargetPath = $TargetPath
  if ($Arguments) { $sc.Arguments = $Arguments }
  if ($WorkDir) { $sc.WorkingDirectory = $WorkDir }
  if ($IconPath -and (Test-Path -LiteralPath $IconPath)) { $sc.IconLocation = "$IconPath,0" }
  $sc.Description = $Description
  $sc.Save()
  Write-Info "Shortcut: $LinkPath"
}

function Install-AppShortcuts([string]$Repo, [string]$AgentRoot, [string]$LaunchPs1) {
  $icon = Join-Path $Repo "scripts\coding-assistant\chat-ui\icons\coding-assistant.ico"
  if (-not (Test-Path -LiteralPath $icon)) {
    Write-Warn2 "Icon not found at $icon — shortcuts will use default icon"
    $icon = $null
  }
  $programs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Run Calculator"
  Ensure-Directory $programs
  $startLink = Join-Path $programs "Local Coding Assistant.lnk"
  # Launch via powershell so window policy is consistent
  $psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  New-CodingAssistantShortcut -LinkPath $startLink -TargetPath $psExe `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$LaunchPs1`"" `
    -WorkDir $Repo -IconPath $icon `
    -Description "Local coding assistant (Ollama loopback, read-only pilot)"

  $desktop = [Environment]::GetFolderPath("Desktop")
  if ($desktop) {
    $deskLink = Join-Path $desktop "Local Coding Assistant.lnk"
    New-CodingAssistantShortcut -LinkPath $deskLink -TargetPath $psExe `
      -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$LaunchPs1`"" `
      -WorkDir $Repo -IconPath $icon `
      -Description "Local coding assistant (Ollama loopback, read-only pilot)"
  }
  # Copy icon into agent dir for stable path
  if ($icon) {
    $iconDest = Join-Path $AgentRoot "coding-assistant.ico"
    Copy-Item -LiteralPath $icon -Destination $iconDest -Force
  }
}


# --- main ---
Write-Host "Production Run Calculator — Coding Assistant installer (read-only pilot)" -ForegroundColor Green
Write-Host "Plant data directory is never modified." -ForegroundColor DarkGray

$repo = Get-RepoRoot
Write-Step "Repository"
Write-Info $repo

Write-Step "Agent directory"
Ensure-Directory $AgentRoot
Ensure-Directory (Join-Path $AgentRoot "config")
Ensure-Directory (Join-Path $AgentRoot "logs")
Write-Info $AgentRoot

$fixture = Join-Path $repo "docs\coding-assistant\fixtures\host-report-candidate-7b.json"
if ($UseFixture -or -not $ReportPath) {
  if (-not $ReportPath) {
    Write-Warn2 "No -ReportPath provided; using bundled fixture (not a measured host qualification)."
    $ReportPath = $fixture
  }
}
if ($UseFixture) { $ReportPath = $fixture }

Write-Step "Host report"
Write-Info $ReportPath
$model = Get-ModelFromReport $ReportPath
Write-Info "Candidate model: $model"

Write-Step "Ollama"
Install-OllamaIfNeeded
if (-not $SkipModelPull) {
  Write-Info "Pulling model '$model' (this can take a long time)..."
  & ollama pull $model
  if ($LASTEXITCODE -ne 0) {
    Fail "ollama pull failed (exit $LASTEXITCODE)"
  }
} else {
  Write-Info "Skipping model pull (-SkipModelPull)"
}

Write-Step "OpenCode"
Install-OpenCodeIfNeeded

Write-Step "Read-only profile"
$profilePath = Join-Path $AgentRoot "config\opencode.local.json"
Invoke-ProfileRender -Repo $repo -Report $ReportPath -OutFile $profilePath

$startPs1 = Join-Path $AgentRoot "Start-CodingAssistant.ps1"
$chatServer = Join-Path $repo "scripts\coding-assistant\chat-ui\server.mjs"
@"
# Launch Local Coding Assistant chat UI (loopback) — does not start plant services
`$ErrorActionPreference = 'Stop'
`$repo = '$repo'
`$profilePath = '$profilePath'
`$model = '$model'
`$port = 7843
`$url = "http://127.0.0.1:`$port/"
`$server = Join-Path `$repo 'scripts\coding-assistant\chat-ui\server.mjs'

Write-Host 'Local Coding Assistant (read-only pilot)' -ForegroundColor Green
Write-Host "Profile: `$profilePath"
Write-Host "Model:   `$model"
Write-Host "Chat UI: `$url"
Write-Host 'Plant data directories are not used.' -ForegroundColor DarkGray

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js is required. Install Node 24+ and re-run the installer.'
  exit 1
}
if (-not (Test-Path -LiteralPath `$server)) {
  Write-Error "Chat UI server missing: `$server"
  exit 1
}

# Start server minimized; open browser
`$args = @(`$server, '--port', "`$port", '--model', `$model)
`$proc = Start-Process -FilePath 'node' -ArgumentList `$args -WorkingDirectory `$repo -WindowStyle Minimized -PassThru
Start-Sleep -Seconds 1
Start-Process `$url

Write-Host ""
Write-Host 'Browser should open to the chat UI.' -ForegroundColor Cyan
Write-Host 'Optional PWA: in Edge use Install app / Apps > Install this site as an app (localhost).'
Write-Host 'OpenCode profile (tool-denial tests):' `$profilePath
Write-Host 'Close this window when finished; stop the node process from Task Manager if needed.'
Write-Host "Server PID: `$(`$proc.Id)"
"@ | Set-Content -LiteralPath $startPs1 -Encoding UTF8

Write-Step "App shortcuts + icon"
Install-AppShortcuts -Repo $repo -AgentRoot $AgentRoot -LaunchPs1 $startPs1

Write-Step "Done"
Write-Host ""
Write-Host "Profile:  $profilePath" -ForegroundColor Green
Write-Host "Model:    $model" -ForegroundColor Green
Write-Host "Agent:    $AgentRoot" -ForegroundColor Green
Write-Host "Repo:     $repo" -ForegroundColor Green
Write-Host "Chat UI:  http://127.0.0.1:7843/ (Start Menu: Local Coding Assistant)" -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Double-click Desktop / Start Menu 'Local Coding Assistant' (chat UI + icon)"
Write-Host "  2. Optional: Edge > Install app for a PWA icon pinned to taskbar"
Write-Host "  3. Optional: OpenCode with the profile for edit/shell denial tests"
Write-Host "  4. Keep Ollama on localhost only; do not use plant data volumes"
Write-Host ""
Write-Host "Helper:   $startPs1"
Write-Host "Icon:     scripts\coding-assistant\chat-ui\icons\coding-assistant.ico"
Write-Host "Runbook:  docs\coding-assistant\pilot-runbook.md"
