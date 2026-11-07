# Windows host — full auto installer

## Goal

**One elevated script** installs and configures the self-host stack:

| Step | What |
|------|------|
| 1 | Admin elevation |
| 2 | PowerShell 7 |
| 3 | Git |
| 4 | WSL2 + Virtual Machine Platform |
| 5 | Docker Desktop + wait for Linux engine |
| 6 | Clone/update repo (`C:\runcalc\app`) |
| 7 | Node.js (LTS; exact pin enforced by upstream launcher) |
| 8 | First-time credentials + images + migrate + start (`Start-SelfHost.ps1`) |
| 9 | Optional coding-agent workspace |
| 10 | `C:\runcalc\RUNBOOK.txt` + logs under `C:\runcalc\logs` |

## Quick start (new PC)

1. Copy `Install-RunCalcHost.ps1` onto the machine.
2. Right-click → **Run with PowerShell**, or:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Install-RunCalcHost.ps1 -NonInteractive -Site "Lucia Plant" -Manager "donald" -TimeZone "America/Chicago"
```

3. If the script reboots for WSL, it schedules **RunOnce** to continue automatically after login.
4. If Docker Desktop shows a **first-run GUI license**, accept it once, then re-run:

```powershell
.\Install-RunCalcHost.ps1 -ContinueAfterReboot -Site "Lucia Plant" -Manager "donald"
```

5. Open `C:\runcalc\RUNBOOK.txt` and hit `/api/readyz`.

## Restart later

```powershell
.\Install-RunCalcHost.ps1 -StartOnly
```

## Optional coding agent

```powershell
.\Install-RunCalcHost.ps1 -StartOnly -IncludeCodingAgent
```

## Defaults

| Setting | Default |
|---------|---------|
| InstallRoot | `C:\runcalc\app` |
| StateDirectory | `C:\runcalc\state` |
| Branch | `main` |
| Site | `Plant` |
| TimeZone | `America/Chicago` |
| Manager | `manager` |

## What still cannot be 100% silent on every PC

Windows limitations (not script bugs):

- **Docker Desktop** may require a one-time GUI accept / logon session  
- **WSL feature enable** may require **one reboot**  
- **winget** must exist (App Installer from Store)  
- Exact **Node** pin from `.nvmrc` may need a manual Node install if winget LTS ≠ pin  
- Upstream **Start-SelfHost** refuses second “fresh” init if volume/env already exist (safe)

## Production honesty

This automates **install + configure + start**.  
It does **not** by itself complete: backup/restore drills, 20-client load test, signed-artifact policy, or Replit cutover.

## Files

- `Install-RunCalcHost.ps1` — full auto installer  
- `README.md` — this file  
