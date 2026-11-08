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

## D. Read-only OpenCode V2 profile (first pilot groundwork)

Use OpenCode V2 **2.2.6 or newer** for the profile's current policy actions. Pin the exact installed version and upgrade deliberately; do not assume a newer version preserves policy behavior without rechecking it. Install Ollama locally and keep it listening on loopback only. Do not add provider/API credentials.

The reviewed template is [`docs/coding-assistant/opencode-readonly.example.json`](coding-assistant/opencode-readonly.example.json). Its provider is a custom OpenAI-compatible adapter pointed at `http://127.0.0.1:11434/v1`; the primary and title-generation model both use that provider. V2 uses `permissions` rules with `action`/`resource`/`effect`, plus hard-deny policies. V1's object-shaped `permission` map and `bash` action are not the native V2 schema. V2 also treats legacy `small_model` as unsupported; use `agents.title.model` instead. See the [V2 migration guide](https://opencode.ai/v2/docs/migrate-v1), [permissions](https://opencode.ai/v2/docs/permissions), [policies](https://opencode.ai/v2/docs/policies), [providers](https://opencode.ai/v2/docs/providers), and [models](https://opencode.ai/v2/docs/models).

The model identifier is intentionally a placeholder until Windows CPU/RAM/GPU/VRAM and normal plant workload are measured. After choosing and downloading an approved Ollama model, replace **every** `REPLACE_WITH_INSTALLED_OLLAMA_MODEL_ID` value with its exact local ID, then run:

```powershell
node scripts/coding-assistant/check-readonly-profile.mjs
```

For the permission/policy restrictions to outrank project and user configuration, install the finalized profile as the OpenCode system configuration at `%ProgramData%\opencode\opencode.jsonc`, under a dedicated non-administrator coding-agent account. System configuration applies machine-wide, so review the impact if other people use OpenCode on this host. Do not treat a project-level copy as a security boundary: system configuration outranks project and user files, while a project-level copy can be overridden. Keep the agent checkout separate from `C:\runcalc\plant`, grant it no plant-volume, database, `.env`, private workbook, or GitHub-token access, and do not expose the agent or Ollama port to plant Wi-Fi.

This profile is a **read-only permission layer**, not a Windows sandbox or a network-egress guarantee. OpenCode, model metadata, updates, or other runtime components may make network requests even when the inference model is local. Before any app diagnostics or write-capable tools are added, verify actual tool denials on the pinned V2 build, audit outbound traffic, and apply and test OS/network controls that block nonlocal outbound traffic while preserving the loopback Ollama path. If any source, prompt, or incident content can leave the host, the no-cloud acceptance fails. The static check above validates config invariants only; it does not pass the runtime, isolation, or egress acceptance tests.

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

