#Requires -Version 5.1
<#
.SYNOPSIS
  One-click (or elevated) install of the local coding-assistant pilot.

.DESCRIPTION
  Checks for and installs what is missing:
    - Agent dirs under C:\runcalc\agent (never touches plant data)
    - Node.js (for profile render + chat UI)
    - Ollama + catalogue model pull
    - OpenCode CLI when possible
    - Read-only OpenCode profile
    - Desktop + Start Menu shortcuts with app icon
    - Optional post-install verification + chat UI launch

  Fail-closed: catalogue models only, loopback Ollama, no cloud providers,
  no write/shell tools in the rendered profile.

.PARAMETER RepoRoot
  Git checkout of Production-run-calculator. Auto-detected when possible.

.PARAMETER ReportPath
  HostInspector JSON. Default: bundled fixture (not a hardware qualification).

.PARAMETER AgentRoot
  Default C:\runcalc\agent

.PARAMETER SkipOllamaInstall / SkipOpenCodeInstall / SkipModelPull / SkipNodeInstall
  Skip individual install steps when already handled offline.

.PARAMETER UseFixture
  Force bundled host-report fixture.

.PARAMETER LaunchChat
  Start the chat UI after a successful install (default: on for interactive).

.PARAMETER NoLaunch
  Do not start chat UI at the end.
#>
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

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}
function Write-Info([string]$Message) { Write-Host "    $Message" }
function Write-Warn2([string]$Message) { Write-Host "    WARN: $Message" -ForegroundColor Yellow }
function Fail([string]$Message) {
  Write-Host "FAIL: $Message" -ForegroundColor Red
  throw $Message
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
  # Common install locations not yet on PATH in this session
  $extra = @(
    "$env:ProgramFiles\nodejs",
    "${env:ProgramFiles(x86)}\nodejs",
    "$env:LOCALAPPDATA\Programs\Ollama",
    "$env:ProgramFiles\Ollama",
    "$env:APPDATA\npm"
  )
  foreach ($p in $extra) {
    if ($p -and (Test-Path -LiteralPath $p)) {
      if ($env:Path -notlike "*$p*") { $env:Path = "$p;$env:Path" }
    }
  }
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Get-RepoRoot {
  if ($RepoRoot) {
    $candidate = [System.IO.Path]::GetFullPath($RepoRoot)
    if (-not (Test-Path -LiteralPath (Join-Path $candidate "package.json"))) {
      Fail "RepoRoot does not look like the app checkout (package.json missing): $candidate"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $candidate "scripts\coding-assistant\bootstrap-local.mjs"))) {
      Fail "RepoRoot missing coding-assistant scripts: $candidate"
    }
    return $candidate
  }
  $here = $PSScriptRoot
  $guess = [System.IO.Path]::GetFullPath((Join-Path $here "..\..\.."))
  if (Test-Path -LiteralPath (Join-Path $guess "package.json")) {
    return $guess
  }
  Fail "Could not detect repo root. Re-run with -RepoRoot path\to\Production-run-calculator"
}

function Install-WingetPackage([string]$Id, [string]$Label) {
  if (-not (Test-Command "winget")) {
    Fail "winget not found. Install '$Label' manually, then re-run this installer."
  }
  Write-Info "Installing $Label via winget ($Id)..."
  & winget install --id $Id -e --accept-package-agreements --accept-source-agreements --disable-interactivity
  $code = $LASTEXITCODE
  # 0 success, -1978335189 already installed (varies) — continue after refresh
  Refresh-Path
  return $code
}

function Ensure-Node {
  Refresh-Path
  if (Test-Command "node") {
    $v = (& node -v 2>$null)
    Write-Info "Node.js present: $v"
    return
  }
  if ($SkipNodeInstall) {
    Fail "Node.js not on PATH and -SkipNodeInstall was set"
  }
  Write-Step "Node.js"
  Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -Label "Node.js LTS" | Out-Null
  Refresh-Path
  if (-not (Test-Command "node")) {
    Fail "Node.js install finished but 'node' is not on PATH. Close this window, open a new Admin PowerShell, and re-run the installer."
  }
  Write-Info "Node.js ready: $(& node -v)"
}

function Ensure-Ollama {
  Refresh-Path
  if (Test-Command "ollama") {
    Write-Info "Ollama present: $((Get-Command ollama).Source)"
  } else {
    if ($SkipOllamaInstall) {
      Fail "Ollama not on PATH and -SkipOllamaInstall was set"
    }
    Install-WingetPackage -Id "Ollama.Ollama" -Label "Ollama" | Out-Null
    Refresh-Path
    if (-not (Test-Command "ollama")) {
      $candidates = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:ProgramFiles\Ollama\ollama.exe"
      )
      foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) {
          $env:Path = "$(Split-Path $c);$env:Path"
          break
        }
      }
    }
    if (-not (Test-Command "ollama")) {
      Fail "Ollama not on PATH after install. Reboot or open a new terminal, then re-run."
    }
  }

  # Make sure the daemon answers on loopback
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 3
    Write-Info "Ollama API reachable on 127.0.0.1:11434"
  } catch {
    Write-Info "Starting Ollama serve in background..."
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 5 | Out-Null
      Write-Info "Ollama API is up"
    } catch {
      Write-Warn2 "Ollama API not reachable yet. Model pull may start the app; if pull fails, open Ollama from the Start Menu and re-run."
    }
  }
}

function Ensure-OpenCode {
  Refresh-Path
  if (Test-Command "opencode") {
    Write-Info "OpenCode present: $((Get-Command opencode).Source)"
    return
  }
  if ($SkipOpenCodeInstall) {
    Write-Warn2 "OpenCode not on PATH; skipped (-SkipOpenCodeInstall). Chat UI still works."
    return
  }
  if (-not (Test-Command "npm")) {
    Write-Warn2 "npm not available; skip OpenCode CLI install. Chat UI still works."
    return
  }
  Write-Info "Installing OpenCode CLI via npm (best-effort)..."
  try {
    & npm install -g opencode-ai 2>$null
    Refresh-Path
    if (-not (Test-Command "opencode")) {
      & npm install -g @opencode-ai/cli 2>$null
      Refresh-Path
    }
  } catch {
    Write-Warn2 "OpenCode npm install failed: $($_.Exception.Message)"
  }
  if (Test-Command "opencode") {
    Write-Info "OpenCode ready: $((Get-Command opencode).Source)"
  } else {
    Write-Warn2 "OpenCode not on PATH. Install later from https://opencode.ai — Chat UI does not need it."
  }
}

function Get-ModelFromReport([string]$JsonPath) {
  if (-not (Test-Path -LiteralPath $JsonPath)) {
    Fail "Report not found: $JsonPath"
  }
  $report = Get-Content -LiteralPath $JsonPath -Raw | ConvertFrom-Json
  if ($report.schemaVersion -ne 1) { Fail "Unsupported report schemaVersion" }
  if ($report.tool -ne "RunCalculator.HostInspector") { Fail "Unexpected report tool" }

  $rec = $null
  if ($report.recommendations -and $report.recommendations.codingAssistant) {
    $rec = $report.recommendations.codingAssistant
  } elseif ($report.codingAssistant) {
    $rec = $report.codingAssistant
  }
  if (-not $rec) { Fail "Report has no codingAssistant recommendation" }

  $model = [string]$rec.modelId
  if (-not $model) { $model = [string]$rec.model }
  $allowed = @("qwen2.5-coder:7b", "qwen3-coder:30b")
  if ($allowed -notcontains $model) {
    Fail "Model '$model' is not in the approved catalogue: $($allowed -join ', ')"
  }
  return $model
}

function Invoke-ProfileRender([string]$Repo, [string]$Report, [string]$OutFile) {
  if (-not (Test-Command "node")) {
    Fail "Node.js is required to render the OpenCode profile."
  }
  $bootstrap = Join-Path $Repo "scripts\coding-assistant\bootstrap-local.mjs"
  if (-not (Test-Path -LiteralPath $bootstrap)) {
    Fail "Missing bootstrap script at $bootstrap"
  }
  Ensure-Directory (Split-Path -Parent $OutFile)
  Write-Info "Rendering read-only profile -> $OutFile"
  & node $bootstrap --report $Report --out $OutFile
  if ($LASTEXITCODE -ne 0) {
    Fail "Profile render failed (exit $LASTEXITCODE)"
  }
  if (-not (Test-Path -LiteralPath $OutFile)) {
    Fail "Expected profile not written: $OutFile"
  }
}

function Invoke-Verify([string]$Repo) {
  $verify = Join-Path $Repo "scripts\coding-assistant\verify-pilot.mjs"
  if (-not (Test-Path -LiteralPath $verify)) {
    Write-Warn2 "verify-pilot.mjs missing; skipping automated verify"
    return
  }
  Write-Info "Running verify-pilot --fixture..."
  & node $verify --fixture
  if ($LASTEXITCODE -ne 0) {
    Write-Warn2 "verify-pilot reported failures (exit $LASTEXITCODE). Review output above."
  } else {
    Write-Info "verify-pilot OK"
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
  } else {
    Copy-Item -LiteralPath $icon -Destination (Join-Path $AgentRoot "coding-assistant.ico") -Force
  }
  $programs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Run Calculator"
  Ensure-Directory $programs
  $psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$LaunchPs1`""
  New-CodingAssistantShortcut -LinkPath (Join-Path $programs "Local Coding Assistant.lnk") `
    -TargetPath $psExe -Arguments $args -WorkDir $Repo -IconPath $icon `
    -Description "Local coding assistant (Ollama loopback, read-only pilot)"
  $desktop = [Environment]::GetFolderPath("Desktop")
  if ($desktop) {
    New-CodingAssistantShortcut -LinkPath (Join-Path $desktop "Local Coding Assistant.lnk") `
      -TargetPath $psExe -Arguments $args -WorkDir $Repo -IconPath $icon `
      -Description "Local coding assistant (Ollama loopback, read-only pilot)"
  }
}

function Write-Launcher([string]$Path, [string]$Repo, [string]$ProfilePath, [string]$Model) {
  @"
# Launch Local Coding Assistant chat UI (loopback) — does not start plant services
`$ErrorActionPreference = 'Stop'
`$repo = '$Repo'
`$profilePath = '$ProfilePath'
`$model = '$Model'
`$port = 7843
`$url = "http://127.0.0.1:`$port/"
`$server = Join-Path `$repo 'scripts\coding-assistant\chat-ui\server.mjs'

Write-Host 'Local Coding Assistant (read-only pilot)' -ForegroundColor Green
Write-Host "Profile: `$profilePath"
Write-Host "Model:   `$model"
Write-Host "Chat UI: `$url"

# Refresh PATH for node/ollama in a fresh shortcut session
`$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
`$user = [Environment]::GetEnvironmentVariable('Path', 'User')
`$env:Path = "`$machine;`$user"
foreach (`$p in @(
  "`$env:ProgramFiles\nodejs",
  "`$env:LOCALAPPDATA\Programs\Ollama",
  "`$env:ProgramFiles\Ollama"
)) {
  if (Test-Path -LiteralPath `$p) { `$env:Path = "`$p;`$env:Path" }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js is required. Re-run Install-CodingAssistant.ps1'
  exit 1
}
if (-not (Test-Path -LiteralPath `$server)) {
  Write-Error "Chat UI server missing: `$server"
  exit 1
}

# Ensure Ollama answers
try {
  Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2 | Out-Null
} catch {
  if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    Start-Sleep -Seconds 2
  }
}

`$argList = @(`$server, '--port', "`$port", '--model', `$model)
`$proc = Start-Process -FilePath 'node' -ArgumentList `$argList -WorkingDirectory `$repo -WindowStyle Minimized -PassThru
Start-Sleep -Seconds 1
Start-Process `$url
Write-Host "Server PID: `$(`$proc.Id)  |  Optional: Edge > Install app for a PWA icon"
"@ | Set-Content -LiteralPath $Path -Encoding UTF8
}

# --- main ---
$logDir = Join-Path $AgentRoot "logs"
Ensure-Directory $AgentRoot
Ensure-Directory $logDir
$logFile = Join-Path $logDir ("install-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
try {
  Start-Transcript -Path $logFile -Force | Out-Null
} catch {
  Write-Warn2 "Could not start transcript: $($_.Exception.Message)"
}

Write-Host "Production Run Calculator — Coding Assistant installer" -ForegroundColor Green
Write-Host "One-click pilot setup (read-only). Plant data is never modified." -ForegroundColor DarkGray
Write-Host "Log: $logFile" -ForegroundColor DarkGray

try {
  Write-Step "Repository"
  $repo = Get-RepoRoot
  Write-Info $repo

  Write-Step "Agent directory"
  Ensure-Directory (Join-Path $AgentRoot "config")
  Ensure-Directory (Join-Path $AgentRoot "logs")
  Write-Info $AgentRoot

  $fixture = Join-Path $repo "docs\coding-assistant\fixtures\host-report-candidate-7b.json"
  if ($UseFixture -or -not $ReportPath) {
    if (-not $ReportPath) {
      Write-Warn2 "No HostInspector report; using bundled fixture (not a measured host qualification)."
      $ReportPath = $fixture
    }
  }
  if ($UseFixture) { $ReportPath = $fixture }

  Write-Step "Host report / model"
  Write-Info $ReportPath
  $model = Get-ModelFromReport $ReportPath
  Write-Info "Catalogue model: $model"

  Write-Step "Node.js"
  Ensure-Node

  Write-Step "Ollama"
  Ensure-Ollama
  if (-not $SkipModelPull) {
    Write-Info "Pulling model '$model' (may take a long time on first run)..."
    & ollama pull $model
    if ($LASTEXITCODE -ne 0) {
      Fail "ollama pull failed (exit $LASTEXITCODE). Check disk space and network, then re-run."
    }
  } else {
    Write-Info "Skipping model pull (-SkipModelPull)"
  }

  Write-Step "OpenCode (optional)"
  Ensure-OpenCode

  Write-Step "Read-only profile"
  $profilePath = Join-Path $AgentRoot "config\opencode.local.json"
  Invoke-ProfileRender -Repo $repo -Report $ReportPath -OutFile $profilePath

  Write-Step "Launcher + shortcuts"
  $startPs1 = Join-Path $AgentRoot "Start-CodingAssistant.ps1"
  Write-Launcher -Path $startPs1 -Repo $repo -ProfilePath $profilePath -Model $model
  Install-AppShortcuts -Repo $repo -AgentRoot $AgentRoot -LaunchPs1 $startPs1

  Write-Step "Verify"
  Invoke-Verify -Repo $repo

  Write-Step "Done"
  Write-Host ""
  Write-Host "Profile:  $profilePath" -ForegroundColor Green
  Write-Host "Model:    $model" -ForegroundColor Green
  Write-Host "Agent:    $AgentRoot" -ForegroundColor Green
  Write-Host "Repo:     $repo" -ForegroundColor Green
  Write-Host "Shortcut: Start Menu / Desktop — Local Coding Assistant" -ForegroundColor Green
  Write-Host "Log:      $logFile" -ForegroundColor Green
  Write-Host ""

  $shouldLaunch = $false
  if ($NoLaunch) { $shouldLaunch = $false }
  elseif ($LaunchChat) { $shouldLaunch = $true }
  else { $shouldLaunch = $true }  # default: launch after interactive install

  if ($shouldLaunch) {
    Write-Step "Launching chat UI"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $startPs1
  } else {
    Write-Host "Next: double-click 'Local Coding Assistant' on the Desktop" -ForegroundColor Cyan
  }

  Write-Host ""
  Write-Host "Notes:" -ForegroundColor Cyan
  Write-Host "  - Keep Ollama on localhost only"
  Write-Host "  - Optional: Edge > Install app (PWA) while chat UI is open"
  Write-Host "  - Optional: OpenCode + profile for edit/shell denial tests"
  Write-Host "  - Do not point the assistant at C:\runcalc\plant volumes"
}
catch {
  Write-Host ""
  Write-Host "INSTALL FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $logFile" -ForegroundColor Yellow
  if (-not $env:CODING_ASSISTANT_INSTALL_NONINTERACTIVE) {
    Write-Host "Press Enter to close..."
    try { [void](Read-Host) } catch {}
  }
  exit 1
}
finally {
  try { Stop-Transcript | Out-Null } catch {}
}

exit 0
