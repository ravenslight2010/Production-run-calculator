#Requires -Version 5.1
<#
.SYNOPSIS
  Fully automated Windows host install + configure for Production Run Calculator (LAN self-host).

.DESCRIPTION
  Installs and configures as much as Windows allows on a clean-ish Windows 10/11 host:

  1. Elevate to Administrator
  2. Install PowerShell 7 (if missing) and re-launch under it
  3. Install Git (if missing)
  4. Enable WSL2 + Virtual Machine Platform
  5. Install Docker Desktop (if missing) and wait for Linux engine
  6. Clone/update application source
  7. Install Node (LTS; exact .nvmrc enforced by upstream Start-SelfHost)
  8. First-time: credentials + pull + migrate + start (via Start-SelfHost.ps1)
  9. Optional coding-agent workspace
  10. Write C:\runcalc\RUNBOOK.txt

  Idempotent. If state/DB already exists, starts without re-init.
  May require ONE reboot after WSL features (script can schedule RunOnce resume).

  Does NOT: migrate Replit production data, claim prod qualification, or skip Docker Desktop GUI license on first run on some hosts.

.EXAMPLE
  # Full auto (Admin)
  .\Install-RunCalcHost.ps1 -NonInteractive -Site "Lucia Plant" -Manager "donald"

.EXAMPLE
  .\Install-RunCalcHost.ps1 -StartOnly
#>
[CmdletBinding()]
param(
  [string]$Site = 'Plant',
  [string]$TimeZone = 'America/Chicago',
  [string]$Manager = 'manager',
  [string]$InstallRoot = 'C:\runcalc\app',
  [string]$StateDirectory = 'C:\runcalc\state',
  [string]$RepoUrl = 'https://github.com/ravenslight2010/Production-run-calculator.git',
  [string]$Branch = 'main',
  [switch]$IncludeCodingAgent,
  [switch]$SkipDockerInstall,
  [switch]$NonInteractive,
  [switch]$ContinueAfterReboot,
  [switch]$StartOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$LogDir = 'C:\runcalc\logs'
$LogFile = Join-Path $LogDir ("install-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
$MarkerReboot = 'C:\runcalc\logs\pending-reboot-continue.flag'

function Ensure-LogDir {
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallRoot -Parent) | Out-Null
}

function Log([string]$Message, [string]$Level = 'INFO') {
  $line = '{0:o} [{1}] {2}' -f (Get-Date).ToUniversalTime(), $Level, $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = [Security.Principal.WindowsPrincipal]::new($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-SelfPath {
  if ($PSCommandPath) { return $PSCommandPath }
  return $MyInvocation.MyCommand.Path
}

function Get-RelaunchArgs {
  $list = New-Object System.Collections.Generic.List[string]
  foreach ($k in $PSBoundParameters.Keys) {
    $v = $PSBoundParameters[$k]
    if ($v -is [System.Management.Automation.SwitchParameter]) {
      if ($v.IsPresent) { $list.Add("-$k") }
    } else {
      $list.Add("-$k")
      $list.Add([string]$v)
    }
  }
  return $list
}

function Relaunch-Elevated {
  $path = Get-SelfPath
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $path) + (Get-RelaunchArgs)
  Log "Re-launching elevated"
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait
  exit $LASTEXITCODE
}

function Test-Cmd([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

function Install-WingetPackage([string]$Id, [string]$DisplayName) {
  if (-not (Test-Cmd 'winget')) {
    throw "winget not found. Install 'App Installer' from Microsoft Store, then re-run."
  }
  Log "Installing $DisplayName ($Id) via winget..."
  & winget install -e --id $Id --accept-package-agreements --accept-source-agreements --disable-interactivity
  Log "winget exit $LASTEXITCODE for $Id"
  Refresh-Path
}

function Ensure-PowerShell7 {
  if ($PSVersionTable.PSVersion.Major -ge 7) {
    Log "PowerShell $($PSVersionTable.PSVersion) OK"
    return
  }
  Log 'Installing PowerShell 7...'
  Install-WingetPackage 'Microsoft.PowerShell' 'PowerShell 7'
  $pwsh = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
  if (-not (Test-Path $pwsh)) { throw 'PowerShell 7 install failed' }
  Log 'Re-launching under PowerShell 7...'
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Get-SelfPath)) + (Get-RelaunchArgs)
  Start-Process -FilePath $pwsh -ArgumentList $argList -Wait -Verb RunAs
  exit $LASTEXITCODE
}

function Ensure-Git {
  if (Test-Cmd 'git') { Log 'Git OK'; return }
  Install-WingetPackage 'Git.Git' 'Git'
  Refresh-Path
  if (-not (Test-Cmd 'git')) { throw 'Git not on PATH after install — sign out/in or reboot, then re-run' }
}

function Ensure-WslFeatures {
  Log 'Enabling WSL + VirtualMachinePlatform...'
  & dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
  & dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Null
  try { & wsl --set-default-version 2 2>$null } catch { Log 'wsl default version set deferred' 'WARN' }
  $reboot = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
  return [bool]$reboot
}

function Ensure-Docker {
  if ($SkipDockerInstall) { Log 'SkipDockerInstall'; return }
  if (Test-Cmd 'docker') {
    $os = & docker info --format '{{.OSType}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $os -eq 'linux') {
      Log 'Docker Linux engine OK'
      return
    }
  }
  Log 'Installing Docker Desktop...'
  Install-WingetPackage 'Docker.DockerDesktop' 'Docker Desktop'
  Refresh-Path
  Log 'Waiting for Docker Linux engine (up to 5 minutes). If a GUI license appears, accept it once.'
  $deadline = (Get-Date).AddMinutes(5)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    Refresh-Path
    if (-not (Test-Cmd 'docker')) { continue }
    $os = & docker info --format '{{.OSType}}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $os -eq 'linux') {
      Log 'Docker Linux engine OK'
      return
    }
  }
  throw 'Docker Linux engine not ready. Start Docker Desktop, switch to Linux containers, then re-run with -ContinueAfterReboot or -StartOnly.'
}

function Ensure-Repo {
  Log "Repo -> $InstallRoot ($Branch)"
  if (-not (Test-Path (Join-Path $InstallRoot '.git'))) {
    if (Test-Path $InstallRoot) { throw "InstallRoot exists but is not a git checkout: $InstallRoot" }
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallRoot -Parent) | Out-Null
    & git clone --branch $Branch --single-branch $RepoUrl $InstallRoot
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
  } else {
    Push-Location $InstallRoot
    try {
      & git fetch origin $Branch
      & git checkout $Branch
      & git pull --ff-only origin $Branch
      if ($LASTEXITCODE -ne 0) { throw 'git pull failed' }
    } finally { Pop-Location }
  }
}

function Ensure-Node([string]$RepoPath) {
  $wanted = $null
  $nvmrc = Join-Path $RepoPath '.nvmrc'
  if (Test-Path $nvmrc) {
    $wanted = (Get-Content $nvmrc -Raw).Trim().TrimStart('v')
    Log "Repo .nvmrc wants Node v$wanted"
  }
  if (Test-Cmd 'node') {
    $cur = (& node --version).Trim().TrimStart('v')
    Log "Node v$cur present"
    if (-not $wanted -or $cur -eq $wanted) { return }
  }
  Install-WingetPackage 'OpenJS.NodeJS.LTS' 'Node.js LTS'
  Refresh-Path
  if (-not (Test-Cmd 'node')) { throw 'Node.js not on PATH after install' }
  Log "Node $(node --version) available"
}

function Invoke-UpstreamLauncher {
  $launcher = Join-Path $InstallRoot 'scripts\self-host\Start-SelfHost.ps1'
  if (-not (Test-Path $launcher)) {
    throw "Missing $launcher — choose a branch that includes scripts/self-host"
  }
  $pwsh = if (Test-Cmd 'pwsh') { 'pwsh' } else { 'powershell' }
  if ($StartOnly) {
    Log 'StartOnly: launching existing stack'
    & $pwsh -NoProfile -File $launcher -StateDirectory $StateDirectory
  } else {
    Log 'InitializeFresh: first-time configure + start'
    & $pwsh -NoProfile -File $launcher -StateDirectory $StateDirectory -InitializeFresh -Site $Site -TimeZone $TimeZone -Manager $Manager
  }
  if ($LASTEXITCODE -ne 0) { throw "Start-SelfHost.ps1 exit $LASTEXITCODE" }
}

function Install-CodingAgent {
  Log 'Coding agent workspace'
  $agentRepo = 'C:\runcalc\agent\Production-run-calculator'
  New-Item -ItemType Directory -Force -Path 'C:\runcalc\agent' | Out-Null
  if (-not (Test-Path (Join-Path $agentRepo '.git'))) {
    & git clone --branch $Branch --single-branch $RepoUrl $agentRepo
  }
  $cfg = Join-Path $agentRepo 'opencode.json'
  if (-not (Test-Path $cfg)) {
    @'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": {
        "qwen2.5-coder:7b": {
          "name": "qwen2.5-coder:7b",
          "limit": { "context": 65536, "output": 8192 }
        }
      }
    }
  },
  "model": "ollama/qwen2.5-coder:7b",
  "permission": [
    { "action": "edit", "resource": "*.env*", "effect": "deny" },
    { "action": "shell", "resource": "git push*", "effect": "ask" },
    { "action": "shell", "resource": "rm -rf*", "effect": "deny" }
  ]
}
'@ | Set-Content -Path $cfg -Encoding UTF8
  }
  if (-not (Test-Cmd 'ollama')) {
    try { Install-WingetPackage 'Ollama.Ollama' 'Ollama' } catch { Log "Ollama optional install: $_" 'WARN' }
  }
}

function Write-Runbook {
  $path = 'C:\runcalc\RUNBOOK.txt'
  @"
Production Run Calculator — Windows self-host
Installed (UTC): $((Get-Date).ToUniversalTime().ToString('o'))
Checkout:  $InstallRoot
State:     $StateDirectory
Branch:    $Branch
Site:      $Site
Manager:   $Manager (bootstrap username only — access code is NOT written here)

Verify:
  docker compose -p runcalc-selfhost ps
  Browser https://<lan-host>/   (trust internal CA if asked)
  GET     https://<lan-host>/api/readyz

Restart:
  pwsh -File $InstallRoot\scripts\self-host\Start-SelfHost.ps1 -StateDirectory $StateDirectory

Re-run installer start-only:
  pwsh -File $(Get-SelfPath) -StartOnly

Logs: $LogDir
Qualification (backup/restore, load, WAN loss) remains your checklist.
"@ | Set-Content -Path $path -Encoding UTF8
  Log "Wrote $path"
}

function Schedule-ContinueAfterReboot {
  $path = Get-SelfPath
  $pwsh = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
  if (-not (Test-Path $pwsh)) { $pwsh = 'powershell.exe' }
  $cmd = "`"$pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$path`" -NonInteractive -ContinueAfterReboot -Site `"$Site`" -TimeZone `"$TimeZone`" -Manager `"$Manager`" -InstallRoot `"$InstallRoot`" -StateDirectory `"$StateDirectory`" -Branch `"$Branch`""
  if ($IncludeCodingAgent) { $cmd += ' -IncludeCodingAgent' }
  Set-Content -Path $MarkerReboot -Value $cmd -Encoding UTF8
  reg add 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce' /v RunCalcHostInstall /t REG_SZ /d $cmd /f | Out-Null
  Log 'Reboot required for WSL features. Rebooting in 30 seconds (Ctrl+C to cancel)...'
  Start-Sleep -Seconds 30
  Restart-Computer -Force
}

# ---- main ----
Ensure-LogDir
Log '=== RunCalc full auto-install ==='

if (-not (Test-IsAdmin)) { Relaunch-Elevated }

if ($PSVersionTable.PSVersion.Major -lt 7) { Ensure-PowerShell7 }

Ensure-Git

if (-not $StartOnly) {
  $needReboot = Ensure-WslFeatures
  if ($needReboot -and -not $ContinueAfterReboot -and -not (Test-Cmd 'docker')) {
    Schedule-ContinueAfterReboot
    return
  }
  Ensure-Docker
}

Ensure-Repo
Ensure-Node -RepoPath $InstallRoot

$envFile = Join-Path $StateDirectory '.env'
$volumes = @()
try { $volumes = @(docker volume ls --format '{{.Name}}' 2>$null) } catch { }

if ($StartOnly -or (Test-Path $envFile) -or ($volumes -contains 'runcalc-selfhost_db-data')) {
  $StartOnly = $true
  Log 'Using start-only path (existing state or -StartOnly)'
  Invoke-UpstreamLauncher
} else {
  Invoke-UpstreamLauncher
}

if ($IncludeCodingAgent) { Install-CodingAgent }

Write-Runbook
Log '=== Finished ==='
Write-Host ''
Write-Host 'Done. Open C:\runcalc\RUNBOOK.txt' -ForegroundColor Green
Write-Host "Log: $LogFile"
