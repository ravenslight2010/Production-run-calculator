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
@"
# Launch helper — does not start plant services
`$ErrorActionPreference = 'Stop'
Write-Host 'Coding assistant profile: $profilePath'
Write-Host 'Repo (open this folder in OpenCode): $repo'
if (Get-Command opencode -ErrorAction SilentlyContinue) {
  Write-Host 'Starting OpenCode...'
  opencode
} else {
  Write-Host 'OpenCode not on PATH. Install from https://opencode.ai and load the profile above.'
}
"@ | Set-Content -LiteralPath $startPs1 -Encoding UTF8

Write-Step "Done"
Write-Host ""
Write-Host "Profile:  $profilePath" -ForegroundColor Green
Write-Host "Model:    $model" -ForegroundColor Green
Write-Host "Agent:    $AgentRoot" -ForegroundColor Green
Write-Host "Repo:     $repo" -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Open the repo in OpenCode using the profile above"
Write-Host "  2. Confirm edit/shell tools are denied"
Write-Host "  3. Keep Ollama on localhost only"
Write-Host "  4. Do not point the assistant at C:\runcalc\plant data volumes"
Write-Host ""
Write-Host "Helper:   $startPs1"
Write-Host "Runbook:  docs\coding-assistant\pilot-runbook.md"
