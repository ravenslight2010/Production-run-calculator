#Requires -Version 5.1
param(
  [ValidateSet("speed","balanced")]
  [string]$Policy = "speed",
  [string]$AgentRoot = "C:\runcalc\agent"
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Select-CodingModel.ps1")

Write-Host "Policy: $Policy" -ForegroundColor Cyan
$c = Get-CodingModelChoice -Policy $Policy
Write-Host ("RAM={0}GB VRAM~={1}GB NVIDIA={2}" -f $c.RamGB, $c.VramGB, $c.HasNvidia)
Write-Host $c.Reason
Write-Host ("Selected: {0}" -f $c.Model) -ForegroundColor Green

New-Item -ItemType Directory -Force -Path (Join-Path $AgentRoot "config") | Out-Null
$c | ConvertTo-Json | Set-Content (Join-Path $AgentRoot "config\model-choice.json") -Encoding UTF8

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { throw "ollama not on PATH" }
Write-Host "Pulling $($c.Model) ..."
& ollama pull $c.Model
if ($LASTEXITCODE -ne 0) { throw "ollama pull failed" }

$app = Join-Path $AgentRoot "app"
$model = $c.Model
$run = Join-Path $AgentRoot "run.ps1"
$lines = @(
  '$ErrorActionPreference = ''Stop'''
  "`$app = '$app'"
  "`$model = '$model'"
  '$port = 7843'
  '$env:Path = [Environment]::GetEnvironmentVariable(''Path'',''Machine'') + '';'' + [Environment]::GetEnvironmentVariable(''Path'',''User'')'
  'foreach ($p in @((Join-Path $env:ProgramFiles ''nodejs''), (Join-Path $env:LOCALAPPDATA ''Programs\Ollama''))) { if (Test-Path $p) { $env:Path = "$p;$env:Path" } }'
  "`$env:RUNCALC_REPO = '$app'"
  'try { Invoke-WebRequest http://127.0.0.1:11434/api/tags -UseBasicParsing -TimeoutSec 2 | Out-Null } catch { Start-Process ollama -ArgumentList serve -WindowStyle Hidden; Start-Sleep 2 }'
  '$server = Join-Path $app ''ui\server.mjs'''
  '$proc = Start-Process node -ArgumentList @($server, ''--port'', "$port", ''--model'', $model) -WorkingDirectory $app -WindowStyle Minimized -PassThru'
  'Start-Sleep 1'
  'Start-Process "http://127.0.0.1:$port/"'
  'Write-Host "model=$model pid=$($proc.Id)"'
)
$lines | Set-Content -LiteralPath $run -Encoding UTF8
Write-Host "Updated $run"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $run
