# Coding Assistant installer (Windows)

Double-click or run the PowerShell installer to set up the **read-only** local coding-assistant pilot.

## What it does

1. Creates `C:\runcalc\agent` (separate from plant)
2. Reads a HostInspector report **or** the bundled fixture
3. Installs **Ollama** via winget when missing
4. Pulls only an approved catalogue model (`qwen2.5-coder:7b` or `qwen3-coder:30b`)
5. Attempts to install **OpenCode**
6. Renders the read-only OpenCode profile with Node

## What it does **not** do

- Modify `C:\runcalc\plant` or production Compose data  
- Enable edit/shell/cloud tools  
- Qualify model quality or plant load impact  
- Merge branches or deploy the app  

## Double-click

1. Clone this repository (or use your existing checkout).  
2. Double-click:

   `scripts\self-host\coding-assistant\Install-CodingAssistant-DOUBLECLICK.cmd`

3. Approve the Administrator prompt if shown.

## PowerShell (recommended)

From the repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\self-host\coding-assistant\Install-CodingAssistant.ps1 -RepoRoot .
```

With a real HostInspector report:

```powershell
.\scripts\self-host\coding-assistant\Install-CodingAssistant.ps1 `
  -RepoRoot . `
  -ReportPath C:\path\to\host-report.json
```

Fixture only (tooling test — not a host qualification):

```powershell
.\scripts\self-host\coding-assistant\Install-CodingAssistant.ps1 -RepoRoot . -UseFixture
```

## After install

- Profile: `C:\runcalc\agent\config\opencode.local.json`  
- Helper: `C:\runcalc\agent\Start-CodingAssistant.ps1`  
- Runbook: `docs\coding-assistant\pilot-runbook.md`  

Open the **repo checkout** in OpenCode with that profile. Confirm edit/shell are denied and Ollama stays on localhost.

## Chat UI (after Ollama)

From the repo checkout (Node):

```bash
pnpm coding-assistant:chat
```

Open `http://127.0.0.1:7843/` — loopback-only, read-only file attach, no shell/edit tools.
