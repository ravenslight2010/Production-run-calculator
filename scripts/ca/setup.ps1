#Requires -Version 5.1
# Code Agent Windows setup — robust, updatable, repairable.
# Prefer double-clicking CA-Setup.cmd at repo root.
[CmdletBinding()]
param(
  [string]$RepoRoot = "",
  [string]$AgentRoot = "C:\runcalc\agent",
  [switch]$Repair,
  [switch]$LaunchChat,
  [switch]$NoLaunch,
  [switch]$AddStartup,
  [switch]$SkipSkillsInstall,
  [switch]$SkipModelPull
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$LogDir = Join-Path $AgentRoot "logs"
Ensure-Dir $LogDir
$LogFile = Join-Path $LogDir ("setup-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

function Ensure-Dir($p) {
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}
Ensure-Dir $LogDir

function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m
  Add-Content -LiteralPath $LogFile -Value $line -ErrorAction SilentlyContinue
  Write-Host $line
}
function Step($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan; Log "STEP: $m" }
function Info($m) { Write-Host "    $m"; Log "  $m" }
function Warn($m) { Write-Host "    WARN: $m" -ForegroundColor Yellow; Log "WARN: $m" }
function Fail($m) { Write-Host "FAIL: $m" -ForegroundColor Red; Log "FAIL: $m"; throw $m }

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

function Enable-LongPaths {
  try {
    $key = "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem"
    if (-not (Test-Path $key)) { return }
    $cur = (Get-ItemProperty -Path $key -Name LongPathsEnabled -ErrorAction SilentlyContinue).LongPathsEnabled
    if ($cur -ne 1) {
      Set-ItemProperty -Path $key -Name LongPathsEnabled -Value 1 -Type DWord -Force
      Info "Enabled Windows long paths (reboot may be required for full effect)"
    } else {
      Info "Long paths already enabled"
    }
  } catch {
    Warn "Could not enable long paths: $_"
  }
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

function Winget-InstallOrUpdate($id, $label) {
  if (-not (HasCmd "winget")) { Fail "winget missing. Install App Installer, then re-run." }
  $attempt = 0
  while ($attempt -lt 3) {
    $attempt++
    Info "winget install/upgrade $label (attempt $attempt)"
    & winget upgrade --id $id -e --accept-package-agreements --accept-source-agreements --disable-interactivity 2>$null
    $up = $LASTEXITCODE
    if ($up -eq 0) { Info "$label upgraded or already current"; break }
    & winget install --id $id -e --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -eq 0) { Info "$label installed"; break }
    if ($attempt -eq 3) { Warn "winget failed for $label after 3 tries" }
    Start-Sleep -Seconds 5
  }
  Refresh-Path
}

function Ensure-Node {
  Refresh-Path
  Step "Node.js"
  Winget-InstallOrUpdate "OpenJS.NodeJS.LTS" "Node.js LTS"
  Refresh-Path
  if (-not (HasCmd "node")) { Fail "Node still not on PATH. Open a NEW Admin PowerShell and re-run." }
  Info "Node $(node -v)"
}

function Ensure-Ollama {
  Refresh-Path
  Step "Ollama"
  if (-not (HasCmd "ollama")) {
    Winget-InstallOrUpdate "Ollama.Ollama" "Ollama"
    Refresh-Path
  } else {
    Info "Ollama present — checking for update"
    Winget-InstallOrUpdate "Ollama.Ollama" "Ollama"
  }
  foreach ($c in @(
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:ProgramFiles\Ollama\ollama.exe"
  )) {
    if (Test-Path -LiteralPath $c) { $env:Path = "$(Split-Path $c);$env:Path"; break }
  }
  if (-not (HasCmd "ollama")) { Fail "Ollama not on PATH after install" }
  Info "Ollama OK"
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 4 | Out-Null
    Info "Ollama API up"
  } catch {
    Info "Starting ollama serve..."
    Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
  }
}

function Ensure-Model($model) {
  if ($SkipModelPull) { Info "Skip model pull"; return }
  Step "Model $model"
  $attempt = 0
  while ($attempt -lt 3) {
    $attempt++
    Info "ollama pull $model (attempt $attempt)"
    & ollama pull $model
    if ($LASTEXITCODE -eq 0) { Info "Model ready"; return }
    Start-Sleep -Seconds 8
  }
  Warn "Model pull failed after retries — you can run Repick-Model.cmd later"
}

function Install-Skills($repo) {
  if ($SkipSkillsInstall) { return }
  Step "Domain skills"
  $src = Join-Path $repo "scripts\coding-assistant\domain-skills"
  $dst = Join-Path $env:USERPROFILE ".config\opencode\skills"
  if (-not (Test-Path $src)) { Warn "No domain-skills folder"; return }
  Ensure-Dir $dst
  Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force
  Info "Skills copied to $dst"
}

function Install-Context($repo) {
  Step "Context pack folder"
  $dst = Join-Path $AgentRoot "context"
  Ensure-Dir $dst
  $src = Join-Path $repo "docs\coding-assistant\context"
  if (Test-Path $src) {
    Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force -ErrorAction SilentlyContinue
    Info "Context docs copied"
  }
  $mem = Join-Path $AgentRoot "config\MEMORY.md"
  Ensure-Dir (Split-Path $mem)
  if (-not (Test-Path $mem)) { Set-Content -LiteralPath $mem -Value "# Project Memory`n`n" -Encoding UTF8 }
}

function Create-Shortcuts($agent, $repo) {
  Step "Shortcuts"
  $Wsh = New-Object -ComObject WScript.Shell
  $icon = Join-Path $agent "app\ui\icons\coding-assistant.ico"
  $target = "powershell.exe"
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $agent 'run.ps1')`""

  foreach ($loc in @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("StartMenu") + "\Programs"
  )) {
    Ensure-Dir $loc
    $lnk = Join-Path $loc "CodeAgent.lnk"
    $s = $Wsh.CreateShortcut($lnk)
    $s.TargetPath = $target
    $s.Arguments = $args
    $s.WorkingDirectory = $agent
    if (Test-Path $icon) { $s.IconLocation = $icon }
    $s.Description = "Local Code Agent"
    $s.Save()
    Info "Shortcut: $lnk"
  }

  # Fix shortcut
  $fix = Join-Path ([Environment]::GetFolderPath("Desktop")) "Fix CodeAgent.lnk"
  $s2 = $Wsh.CreateShortcut($fix)
  $s2.TargetPath = "powershell.exe"
  $s2.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $repo 'scripts\ca\helpers\Fix-CodeAgent.cmd')`""
  $s2.Description = "Restart Code Agent"
  $s2.Save()
}

function Add-Startup {
  if (-not $AddStartup) { return }
  Step "Startup"
  $startup = [Environment]::GetFolderPath("Startup")
  $lnk = Join-Path $startup "CodeAgent.lnk"
  $Wsh = New-Object -ComObject WScript.Shell
  $s = $Wsh.CreateShortcut($lnk)
  $s.TargetPath = "powershell.exe"
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $AgentRoot 'run.ps1')`""
  $s.Save()
  Info "Added to Startup: $lnk"
}

function Write-RunScript($agent, $model, $repo) {
  $run = Join-Path $agent "run.ps1"
  @"
`$ErrorActionPreference = 'Stop'
`$app = '$agent\app'
`$model = '$model'
`$port = 7843
`$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
foreach (`$p in @((Join-Path `$env:ProgramFiles 'nodejs'), (Join-Path `$env:LOCALAPPDATA 'Programs\Ollama'))) { if (Test-Path `$p) { `$env:Path = "`$p;`$env:Path" } }
`$env:RUNCALC_REPO = '$repo'
try { Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 2 | Out-Null } catch { Start-Process ollama -ArgumentList serve -WindowStyle Hidden; Start-Sleep 2 }
`$server = Join-Path `$app 'ui\server.mjs'
Start-Process node -ArgumentList @(`$server, '--port', "`$port", '--model', `$model) -WorkingDirectory `$app -WindowStyle Minimized
Start-Sleep 1
Start-Process "http://127.0.0.1:`$port/"
"@ | Set-Content -LiteralPath $run -Encoding UTF8
  Info "Wrote $run"
}

function Copy-UI($repo, $agent) {
  Step "UI + server"
  $src = Join-Path $repo "scripts\coding-assistant\chat-ui"
  $dst = Join-Path $agent "app\ui"
  Ensure-Dir $dst
  if (Test-Path $src) {
    Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force
    Info "UI copied to $dst"
  } else {
    Warn "chat-ui folder missing"
  }
}

function Verify($agent) {
  Step "Verification"
  $ok = $true
  Refresh-Path
  if (-not (HasCmd "node")) { Warn "Node missing"; $ok = $false }
  if (-not (HasCmd "ollama")) { Warn "Ollama missing"; $ok = $false }
  try {
    Invoke-WebRequest "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 4 | Out-Null
    Info "Ollama API OK"
  } catch { Warn "Ollama API not responding"; $ok = $false }
  $server = Join-Path $agent "app\ui\server.mjs"
  if (-not (Test-Path $server)) { Warn "server.mjs missing"; $ok = $false } else { Info "server.mjs present" }
  if ($ok) { Info "Verification passed" } else { Warn "Verification had issues — see log" }
  return $ok
}

# ---------- main ----------
Step "Code Agent Setup"
Log "AgentRoot=$AgentRoot Repair=$Repair"
Enable-LongPaths
$repo = Get-Repo
Info "Repo: $repo"

Ensure-Node
Ensure-Ollama

$model = "qwen2.5-coder:7b"
Ensure-Model $model

Copy-UI $repo $AgentRoot
Install-Skills $repo
Install-Context $repo
Write-RunScript $AgentRoot $model $repo
Create-Shortcuts $AgentRoot $repo
Add-Startup

$verified = Verify $AgentRoot

if ($LaunchChat -and -not $NoLaunch) {
  Step "Launch"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AgentRoot "run.ps1")
}

Step "Done"
Info "Log: $LogFile"
if (-not $verified) { exit 1 }
exit 0
