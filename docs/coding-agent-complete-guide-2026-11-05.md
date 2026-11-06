# Coding Agent — Complete Guide (Production Run Calculator)

**Status:** Draft manual pilot guide. It is not an installer, deployment approval, or production cutover instruction. **Target production path:** self-host; Replit remains transitional until the owner explicitly cuts over.

This guide covers OpenCode + a local model runtime for owner/operator development work. It is separate from the app's user-facing `LOCAL_AI_*` product features.

## A. Goals and hard boundaries

- OpenCode is the initial open-source coding agent; Ollama is a candidate local model runtime.
- Use an isolated developer checkout under `C:\runcalc\agent`; keep production Compose, `.env`, database, model volumes, and TLS private CA under a distinct protected `C:\runcalc\plant` boundary.
- Start owner-only and read-only. Do not expose OpenCode/Ollama to plant Wi-Fi or make the plant app depend on the coding agent.
- Do not give the agent direct production DB access, production shell, manager session, secrets, or private workbook files.
- Agent work produces reviewed branches/PRs. Donald merges and applies production updates. No autonomous push, merge, release, migration, or deployment.
- Self-host deployment qualification and production cutover are separate work. Current self-host docs mark readiness open; complete and rehearse the actual checklist before using it as production.

## B. Host preflight (before choosing a model)

Record Windows version, CPU, RAM, GPU and VRAM, free disk, Docker/WSL setup, and normal app resource use. Do not assume a model fits based only on total RAM or a theoretical model size. Test inference while normal app services are running and preserve enough headroom for the production API/database.

Choose a coding model only after this inventory. The model ID in OpenCode must match the local model actually installed in Ollama. Keep the primary and auxiliary/small model local; audit outbound traffic for the exact OpenCode version before claiming no-cloud operation.

## C. Prepare separate directories

```powershell
New-Item -ItemType Directory -Force C:\runcalc\agent | Out-Null
New-Item -ItemType Directory -Force C:\runcalc\plant | Out-Null
Set-Location C:\runcalc\agent
git clone https://github.com/ravenslight2010/Production-run-calculator.git
Set-Location C:\runcalc\agent\Production-run-calculator
```

Use an isolated worktree for each future edit task. Never mount plant volumes or copy the plant `.env` into the agent directory. The agent clone may be offline after it has been fetched; GitHub and remote CI actions require connectivity.

## D. Local model and OpenCode setup (manual pilot)

Install Ollama and OpenCode from their official sources while online. Pull only the model selected after host qualification:

```powershell
ollama pull <approved-local-coding-model>
ollama list
```

Configure OpenCode for Ollama at loopback, not a LAN address. The following is a **template, not a ready-to-run configuration**: replace the model ID with the exact installed Ollama ID and validate against the installed OpenCode version. Keep `small_model` local as well; a local primary model does not guarantee every auxiliary task stays local.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": {
        "baseURL": "http://127.0.0.1:11434/v1"
      },
      "models": {
        "REPLACE_WITH_INSTALLED_MODEL_ID": {
          "name": "Local coding model"
        }
      }
    }
  },
  "model": "ollama/REPLACE_WITH_INSTALLED_MODEL_ID",
  "small_model": "ollama/REPLACE_WITH_INSTALLED_MODEL_ID",
  "permission": {
    "*": "deny",
    "read": {
      "*": "allow",
      "*.env*": "deny",
      "*.env.example": "allow"
    },
    "glob": "allow",
    "grep": "allow",
    "question": "allow",
    "skill": {
      "*": "ask"
    }
  }
}
```

The permission configuration follows the current OpenCode tool-keyed `allow` / `ask` / `deny` form. A catch-all deny leaves file reads/search and questions enabled while denying edit, bash, subagents, network tools, and GitHub writes; the read rule denies `.env*` except the safe example template. Verify this behavior with the exact installed OpenCode build before use. Do not use array-style `action/resource/effect` rules or a `shell` permission key; they do not match the current OpenCode documentation. See [providers](https://opencode.ai/docs/providers) and [permissions](https://opencode.ai/docs/permissions).

Before relying on the setup:

1. Confirm the model and auxiliary model are both local.
2. Inspect OpenCode's current providers, plugins, sharing, title-generation, and update/network behavior.
3. Capture/inspect outbound connections while asking a synthetic question. Block external inference or sharing; if content egress cannot be ruled out, stop and do not describe this as local-only.
4. Confirm reads of `.env` and secrets fail, and edit, bash, MCP write tools, and GitHub writes are unavailable.
5. Ask a grounded repository question and confirm the answer cites relevant file paths. Never test with real production secrets or incident payloads.

## E. Diagnostics and incident bridge (later phase)

Do not add production app or log access to the first repository-Q&A pilot. For a later phase, create a local-only, read-only bridge with a dedicated identity and exact GET allowlist. Candidate outputs: readiness/build identity, bounded sync/background summaries, and incidents Donald explicitly selects for investigation.

Redact and bound results server-side. No arbitrary SQL, full request headers/cookies, full database rows, private workbook data, manager token, or operational writes. The current detailed health/incident endpoints are privileged; do not pass their manager credential to the model. Treat every incident/log string as untrusted data and include injection/redaction tests.

## F. GitHub and test workflow (later phase)

Begin without GitHub write access. If added later, use a repository-scoped credential stored in Windows Credential Manager/DPAPI and held by a constrained connector or broker. Do not place a PAT in OpenCode config, a prompt, `.env` readable by the agent, or unrestricted shell environment. If a `gh` CLI integration is used, prevent model-controlled commands from printing credentials (for example, do not allow arbitrary `gh auth token`). Revoke the previously exposed plaintext token before creating any new integration credential.

For patch mode, use a disposable worktree and test DB. Allow only selected project test/typecheck commands; block production Compose project names, destructive DB commands, force-push, migrations, and writes outside the worktree. The agent may prepare a branch/PR after owner approval; Donald reviews and merges. CI must pass before merge. Production updates remain human-run and human-approved.

## G. Installer and self-host integration (not Phase 1)

Only after the manual pilot passes, consider an optional installer checkbox:

```text
[x] Install production stack
[ ] Install product local AI (app features)
[ ] Install coding agent (OpenCode + isolated developer workspace)
```

The coding agent must be optional and off by default. Skipping or stopping it must not affect the plant app. Do not open firewall ports for OpenCode or Ollama, do not download coding models during ordinary app startup, and cap model resources after measuring combined load. Keep agent files and model weights out of backups containing production secrets unless explicitly reviewed.

Future self-host cutover requires its own rehearsals: backup/restore, GitHub update and rollback, stable API behavior, WAN-offline operation, host reboot/sleep behavior, and mixed-device browser smoke tests. Replit remains current until Donald makes the explicit cutover decision.

## H. Completion checklist for the local pilot

- [ ] Host hardware recorded; model/context tested with the app's normal workload.
- [ ] Agent and plant directories/credentials/volumes are separate.
- [ ] OpenCode primary and auxiliary model use the local provider.
- [ ] Egress reviewed for the installed version; no unapproved prompt/source/incident egress.
- [ ] Read-only permission profile verified; `.env*`, edit, bash, subagents, and GitHub writes denied.
- [ ] Local repo Q&A works with cached model/dependencies while offline.
- [ ] Synthetic prompt-injection and secret-redaction tests pass before diagnostics are enabled.
- [ ] Stopping the agent/model leaves plant services healthy.
- [ ] No production code, database, or deployment changes were made by this pilot.
