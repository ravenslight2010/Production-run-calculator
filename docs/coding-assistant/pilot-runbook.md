# Coding assistant pilot runbook

Fail-closed pilot: **local Ollama + read-only tooling**. No cloud
providers, no write tools against the plant.

## Windows installer (recommended)

Double-click:

`scripts\self-host\coding-assistant\Install-CodingAssistant-DOUBLECLICK.cmd`

Or PowerShell from the repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\self-host\coding-assistant\Install-CodingAssistant.ps1 -RepoRoot .
```

Details: `scripts/self-host/coding-assistant/README.md`.

## Verify the pilot path (do this first)

From the repo (Node 20+):

```bash
node --test ./scripts/coding-assistant/tests
node ./scripts/coding-assistant/verify-pilot.mjs --fixture
# After Ollama is installed and a catalogue model is pulled:
node ./scripts/coding-assistant/verify-pilot.mjs --fixture --live
```

Or: `pnpm coding-assistant:verify`

### Known gaps (honest)

| Item | Status |
|------|--------|
| Unit tests + profile render | Automated in `verify-pilot` |
| Read-only **template** invariants | Automated |
| Ollama installed + catalogue model | Probe / `--live` |
| OpenCode CLI install | Best-effort in Windows installer; package names vary — may need manual install from https://opencode.ai |
| OpenCode **runtime** denies edit/shell | **Manual** — not automatable without OpenCode |
| HostInspector real report | Preferred over `--fixture` for hardware qualification |
| Chat UI | Local pilot at `pnpm coding-assistant:chat` (loopback) |

## Prerequisites

- Windows x64 host preferred (HostInspector is Windows-only).
- Separate directories:
  - Plant: e.g. `C:\runcalc\plant` — production
  - Agent: e.g. `C:\runcalc\agent` — disposable git checkout + configs

## 1. Host recommendation

Run **RunCalculator.HostInspector** and save the JSON report.

Tooling-only (not a host qualification):

```bash
pnpm coding-assistant:bootstrap -- --fixture --out .opencode/opencode.local.json
```

## 2. Render the read-only OpenCode profile

```bash
pnpm coding-assistant:check
pnpm coding-assistant:bootstrap -- --report path/to/inspection.json --out .opencode/opencode.local.json
```

Confirm model id is catalogue-only (`qwen2.5-coder:7b` or `qwen3-coder:30b`).

## 3. Install local inference (Ollama)

1. Install [Ollama](https://ollama.com) for Windows (or use the installer script).
2. Pull **only** the recommended model, e.g. `ollama pull qwen2.5-coder:7b`
3. Keep Ollama on loopback (`127.0.0.1:11434`).

## 4A. Chat UI pilot (no OpenCode required)

```bash
pnpm coding-assistant:chat
# open http://127.0.0.1:7843/
```

- Loopback-only server
- Optional read-only file attach from repo tree
- Does **not** grant edit/shell tools (there are none in this UI)

## 4B. OpenCode pilot (tool-denial testing)

1. Install OpenCode: https://opencode.ai  
2. Point it at `.opencode/opencode.local.json` (or your `--out` path).  
3. Open the **agent** checkout — not plant data volumes.

## 5. Acceptance checks

- [ ] `verify-pilot --fixture` exits 0  
- [ ] Chat UI answers a simple repo question with Ollama up  
- [ ] OpenCode session (if used): edit/shell/web denied  
- [ ] No cloud provider in rendered profile  
- [ ] Ollama on localhost only  
- [ ] Plant app stays usable during a short prompt (subjective)

## 6. Out of scope until later

- App diagnostics / incident bridge  
- GitHub write or auto-PR  
- Floor-user product AI  
- Merging into Replit production without deliberate cutover  

## Commands

```bash
pnpm coding-assistant:test
pnpm coding-assistant:verify
pnpm coding-assistant:check
pnpm coding-assistant:bootstrap -- --fixture --out .opencode/opencode.local.json
pnpm coding-assistant:chat
```
