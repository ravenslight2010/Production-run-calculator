# Coding assistant Windows installer

## One-click

1. Use a full git checkout of **Production-run-calculator** on branch `feature/local-coding-assistant` (or a release that includes these scripts).
2. Double-click **either**:
   - `Install-CodingAssistant.cmd` at the **repo root**, or  
   - `scripts\self-host\coding-assistant\Install-CodingAssistant-DOUBLECLICK.cmd`
3. Approve the Administrator prompt (needed for winget installs).
4. Wait — first **model pull** can take a long time.
5. When finished, the **chat UI** should open and shortcuts are on the Desktop / Start Menu.

### What it checks and installs if missing

| Component | Action |
|-----------|--------|
| Agent dirs | `C:\runcalc\agent\config`, `logs` (never plant) |
| **Node.js LTS** | winget `OpenJS.NodeJS.LTS` |
| **Ollama** | winget `Ollama.Ollama` + start API on loopback |
| **Model** | `ollama pull` catalogue model from report/fixture only |
| **OpenCode CLI** | best-effort npm global (optional; chat UI works without it) |
| **Profile** | read-only OpenCode JSON under agent `config` |
| **Shortcuts + icon** | Desktop + Start Menu “Local Coding Assistant” |
| **Verify** | `verify-pilot --fixture` |
| **Launch** | starts chat UI on `http://127.0.0.1:7843/` |

### Optional PWA icon

With the chat UI open in Edge: **Install app** / Apps → Install this site as an app.

### Logs

`C:\runcalc\agent\logs\install-*.log`

### Advanced

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\self-host\coding-assistant\Install-CodingAssistant.ps1 `
  -RepoRoot . -ReportPath path\to\host-report.json -LaunchChat
```

Switches: `-SkipNodeInstall`, `-SkipOllamaInstall`, `-SkipModelPull`, `-SkipOpenCodeInstall`, `-NoLaunch`, `-UseFixture`.
