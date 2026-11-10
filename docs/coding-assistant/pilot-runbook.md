# Coding assistant pilot runbook (read-only)

**Goal:** Run OpenCode against this repo with a local Ollama model and a fail-closed read-only profile. No plant production dependency, no cloud providers, no write tools.

## Prerequisites

- Windows x64 host preferred (HostInspector is Windows-only).
- Separate directories:
  - Plant: e.g. `C:\runcalc\plant` (Compose, env, volumes) — production
  - Agent: e.g. `C:\runcalc\agent` (git checkout, OpenCode config) — disposable

## 1. Host recommendation

On the Windows host, run **RunCalculator.HostInspector** and save the JSON report.

Or, for tooling tests only, use the bundled fixture (not a real host qualification):

```bash
pnpm coding-assistant:bootstrap -- --fixture --out .opencode/opencode.local.json
```

## 2. Render the read-only OpenCode profile

```bash
pnpm coding-assistant:check
pnpm coding-assistant:bootstrap -- --report path/to/inspection.json --out .opencode/opencode.local.json
```

Confirm the printed model id (catalogue only), e.g. `qwen2.5-coder:7b` or `qwen3-coder:30b`.

## 3. Install local inference (Ollama)

1. Install [Ollama](https://ollama.com) for Windows.
2. Pull **only** the recommended model, e.g.:

   ```bash
   ollama pull qwen2.5-coder:7b
   ```

3. Keep Ollama on loopback (`127.0.0.1:11434`). Do not bind to the plant LAN.

## 4. Install OpenCode

1. Install OpenCode for your OS: https://opencode.ai  
2. Point it at the rendered config (`.opencode/opencode.local.json` or your `--out` path).  
3. Open the **agent** checkout of this repository (not the plant data directory).

## 5. Acceptance checks (must pass before diagnostics)

- [ ] Session answers a simple repo question from local files only  
- [ ] Edit / shell / web tools are denied by the profile  
- [ ] No cloud provider is configured in the profile  
- [ ] Ollama remains on localhost  
- [ ] Plant app/API stays responsive under a short coding prompt (subjective first pass)

## 6. Explicitly out of scope until later

- App diagnostics / incident bridge  
- GitHub write or auto-PR  
- In-app chat UI for floor users  
- Merging this branch into Replit production without a deliberate cutover

## Commands

```bash
pnpm coding-assistant:test
pnpm coding-assistant:check
pnpm coding-assistant:bootstrap -- --fixture --out .opencode/opencode.local.json
```
