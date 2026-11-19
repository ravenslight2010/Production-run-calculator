#Requires -Version 5.1
param(
  [string]$AgentRoot = "C:\runcalc\agent",
  [string]$RepoPath = ""
)
$ErrorActionPreference = "Stop"

function Info([string]$m) { Write-Host "  $m" }
function Fail([string]$m) { Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }

Write-Host "Enable WRITE mode for Code Agent (repo folder only)" -ForegroundColor Yellow
Write-Host "Plant data paths are still off-limits." -ForegroundColor DarkGray

$app = Join-Path $AgentRoot "app"
$server = Join-Path $app "ui\server.mjs"
$index = Join-Path $app "ui\index.html"
$run = Join-Path $AgentRoot "run.ps1"
$cfg = Join-Path $AgentRoot "config"
if (-not (Test-Path $server)) { Fail "Agent not installed at $AgentRoot" }

if (-not $RepoPath) {
  $op = Join-Path $cfg "operational.json"
  if (Test-Path $op) {
    try { $RepoPath = [string](Get-Content $op -Raw | ConvertFrom-Json).repoPath } catch {}
  }
}
if (-not $RepoPath -or -not (Test-Path $RepoPath)) {
  $RepoPath = $app
}
# Block obvious plant paths
$low = $RepoPath.ToLowerInvariant()
if ($low -match '\\plant\\' -or $low -eq 'c:\runcalc\plant') {
  Fail "Refusing plant data path: $RepoPath"
}

Info "Writable root: $RepoPath"

# Patch server.mjs - add write API if missing
$js = Get-Content -LiteralPath $server -Raw
if ($js -notmatch "api/write") {
  $marker = 'if (req.method === "POST" && url.pathname === "/api/chat")'
  if ($js -notmatch [regex]::Escape($marker)) { Fail "server.mjs layout unexpected - cannot patch" }
  $writeHandler = @'

  if (req.method === "POST" && url.pathname === "/api/write") {
    if (process.env.CA_ALLOW_WRITE !== "1") {
      return send(res, 403, { error: "writes disabled; set CA_ALLOW_WRITE=1" });
    }
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "invalid JSON" }); }
    const rel = String(payload.path || "");
    const content = String(payload.content ?? "");
    const abs = safeResolve(rel);
    if (!abs) return send(res, 400, { error: "path blocked" });
    if (rel.includes(".env") || /\\.(pem|key|p12|pfx)$/i.test(rel)) {
      return send(res, 403, { error: "refusing sensitive path" });
    }
    try {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
      return send(res, 200, { ok: true, path: rel, bytes: content.length });
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  }

'@
  $js = $js.Replace($marker, $writeHandler + "`n  " + $marker)
  # Also update system prompt line if present
  $js = $js.Replace(
    'You cannot edit files, run shell commands, or access the network beyond this chat.',
    'When CA_ALLOW_WRITE=1 the operator may save files under the configured repo root via the UI. You still cannot run shell or reach the network beyond Ollama.'
  )
  Set-Content -LiteralPath $server -Value $js -Encoding UTF8
  Info "Patched server.mjs with /api/write"
} else {
  Info "server already has /api/write"
}

# Patch index.html - add Save button for last attached file
$html = Get-Content -LiteralPath $index -Raw
if ($html -notmatch "api/write") {
  $html = $html.Replace('read-only pilot', 'write-enabled (repo only)')
  $html = $html.Replace(
    '<button type="submit" class="primary" id="send">Send</button>',
    '<button type="submit" class="primary" id="send">Send</button><button type="button" id="saveFile" title="Save active context file">Save file</button>'
  )
  $saveJs = @'

    document.getElementById("saveFile").addEventListener("click", async () => {
      const path = contextFiles.size ? [...contextFiles][0] : prompt("Relative path under repo to write:");
      if (!path) return;
      const content = prompt("Paste full new file content for " + path + " (replaces file):");
      if (content === null) return;
      try {
        const r = await fetch("/api/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || r.statusText);
        addMsg("system", "Saved " + path + " (" + data.bytes + " bytes)");
      } catch (e) {
        addMsg("system", "Save failed: " + e.message);
      }
    });
'@
  $html = $html.Replace('health();\n    loadTree("");', "health();`n    loadTree(\"\");`n" + $saveJs)
  # try alternate
  if ($html -notmatch "saveFile") {
    $html = $html.Replace('loadTree("");', "loadTree(\"\");`n" + $saveJs)
  }
  Set-Content -LiteralPath $index -Value $html -Encoding UTF8
  Info "Patched index.html with Save file"
} else {
  Info "index already write-aware"
}

# Rewrite run.ps1 with CA_ALLOW_WRITE=1
$model = "qwen2.5-coder:3b"
$choice = Join-Path $cfg "model-choice.json"
if (Test-Path $choice) {
  try { $model = [string](Get-Content $choice -Raw | ConvertFrom-Json).Model } catch {}
}
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('$ErrorActionPreference = "Stop"')
[void]$sb.AppendLine(('$app = "{0}"' -f $app))
[void]$sb.AppendLine(('$model = "{0}"' -f $model))
[void]$sb.AppendLine(('$repo = "{0}"' -f $RepoPath))
[void]$sb.AppendLine('$port = 7843')
[void]$sb.AppendLine('$env:CA_ALLOW_WRITE = "1"')
[void]$sb.AppendLine('$env:RUNCALC_REPO = $repo')
[void]$sb.AppendLine('$mp = [Environment]::GetEnvironmentVariable("Path", "Machine")')
[void]$sb.AppendLine('$up = [Environment]::GetEnvironmentVariable("Path", "User")')
[void]$sb.AppendLine('$env:Path = "$mp;$up"')
[void]$sb.AppendLine('foreach ($p in @("$env:ProgramFiles\nodejs", "$env:LOCALAPPDATA\Programs\Ollama", "$env:ProgramFiles\Ollama")) { if (Test-Path $p) { $env:Path = "$p;$env:Path" } }')
[void]$sb.AppendLine('try { Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 2 | Out-Null } catch { Start-Process ollama -ArgumentList serve -WindowStyle Hidden; Start-Sleep 2 }')
[void]$sb.AppendLine('$server = Join-Path $app "ui\server.mjs"')
[void]$sb.AppendLine('try { $ex = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($ex) { Stop-Process -Id $ex.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep 1 } } catch { }')
[void]$sb.AppendLine('$proc = Start-Process -FilePath "node" -ArgumentList @($server, "--port", "$port", "--model", $model) -WorkingDirectory $app -WindowStyle Minimized -PassThru')
[void]$sb.AppendLine('Start-Sleep 2')
[void]$sb.AppendLine('Start-Process "http://127.0.0.1:$port/"')
[void]$sb.AppendLine('Write-Host "WRITE-ENABLED model=$model repo=$repo pid=$($proc.Id)"')
[System.IO.File]::WriteAllText((Join-Path $AgentRoot "run.ps1"), $sb.ToString())

$mode = @{
  allowWrite = $true
  repoPath = $RepoPath
  plantBlocked = $true
  enabledAtUtc = (Get-Date).ToUniversalTime().ToString("o")
}
$mode | ConvertTo-Json | Set-Content (Join-Path $cfg "write-mode.json") -Encoding UTF8

Info "CA_ALLOW_WRITE=1 set in run.ps1"
Write-Host ""
Write-Host "WRITE MODE ON for: $RepoPath" -ForegroundColor Green
Write-Host "Use Desktop CodeAgent, then Save file in the UI."
Write-Host "Still no shell and no plant data access."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AgentRoot "run.ps1")
