# Short-path coding assistant setup

## Double-click

From the **repo root**:

`CA-Setup.cmd`

That is the supported one-click installer (short name for Windows).

## What it does

1. Elevates to Administrator  
2. Installs **Node** / **Ollama** / model if missing  
3. Copies chat UI + helper scripts to **`C:\runcalc\agent\app\`** (short paths)  
4. Writes profile to **`C:\runcalc\agent\config\oc.json`**  
5. Creates shortcuts: **`CodeAgent.lnk`** (Desktop + Start Menu)  
6. Launches chat at `http://127.0.0.1:7843/`  

Logs: `C:\runcalc\agent\logs\setup-*.log`

## Names (kept short on purpose)

| Item | Path / name |
|------|-------------|
| Installer | `CA-Setup.cmd` |
| Setup script | `scripts\ca\setup.ps1` |
| Agent home | `C:\runcalc\agent\` |
| Chat payload | `C:\runcalc\agent\app\ui\` |
| Profile | `C:\runcalc\agent\config\oc.json` |
| Run helper | `C:\runcalc\agent\run.ps1` |
| Shortcut | `CodeAgent.lnk` |
