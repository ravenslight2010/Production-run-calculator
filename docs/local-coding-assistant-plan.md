# Local Coding Assistant for Production Run Calculator

**Status:** Phase 0 design on `feature/local-coding-assistant`. This document does not enable an agent, add runtime routes, change production, or authorize a deployment.

## Objective

Plan an owner-operated coding assistant on the semi-dedicated Windows host used for self-hosting. Use OpenCode as the coding agent and a local model runtime such as Ollama as the model provider. The goal is to help maintain this repository, investigate app-reported problems, run project checks, and prepare reviewed GitHub changes.

This is a developer tool, not an AI feature for floor or office users. The app's existing local-AI integration serves product features; it is separate from the coding agent.

## Current project baseline

- The repository already documents a local-model adapter and an optional Ollama Compose profile for the app's AI features (`docs/local-ai-deployment.md`, `docker-compose.local-ai.yml`).
- The API has coarse health/readiness endpoints and a manager-protected `/health/diagnostics` route, with sync-outbox and background-operation diagnostics (`artifacts/api-server/src/routes/health.ts`).
- Signed-in users can report issues/crashes; manager review routes and correlation IDs exist (`artifacts/api-server/src/routes/incidents.ts`).
- The self-hosted Windows/LAN deployment is still marked draft/not production-ready in `docs/self-host/README.md`. The root README identifies Replit as the only authorized publisher of the active production app. This effort must not bypass either boundary.

## Proposed boundaries

### 1. Separate control plane from production

Run OpenCode and its model service locally on the Windows host, initially available only to Donald on that host. Do not expose OpenCode, Ollama, shell access, or a coding-agent API to floor/office clients or the general LAN. If remote administration is later needed, add a separately reviewed authenticated access layer; do not solve it by exposing the model port.

Keep the agent's Git checkout/worktrees, temporary files, and test database separate from production containers, volumes, credentials, and operational data. The production app must continue serving normally if the coding agent or model is stopped.

### 2. Start read-only, with an allowlisted diagnostics bridge

The first prototype may read repository source and a deliberately small diagnostics contract. It must not receive direct database access, unrestricted host logs, or a production shell.

Potential initial data: health/readiness status, build identity, bounded sync/background-worker summaries, and manager-reviewed incident records explicitly selected for investigation. Return only fields needed for diagnosis, with bounded result sizes and redaction. Preserve correlation IDs where useful, but do not pass credentials, session tokens, raw request headers, full database rows, private workbook contents, or unrelated staff data.

The current detailed health endpoint and incident review routes require elevated capabilities. Do not give an LLM a manager session or assume those existing routes are a safe agent API. Before connecting them, create a narrow read-only identity/bridge whose server-side allowlist cannot perform operational writes. Prefer aggregate/sanitized diagnostics over raw log streaming.

Treat all repository text, issue reports, log messages, model output, and external GitHub content as untrusted data—not instructions. Add prompt-injection fixtures to the diagnostic bridge tests.

### 3. OpenCode, models, skills, and permissions

OpenCode can use local Ollama models, load reusable `SKILL.md` instructions, and connect selected tools through MCP. Use only reviewed project skills relevant to coding, testing, incident triage, and PR preparation; the repo's `.agents/skills` is already an established skill root. Do not install unreviewed external skills automatically.

Do not rely on permissive defaults. Configure an explicit read-only agent first: allow repository reads/search, deny edits and shell by default, and do not load write-capable GitHub tools. Later modes may grant narrowly scoped capabilities, but edits stay in a disposable worktree and shell commands require approval or an explicit allowlist. Push, merge, publish, database migration, and production operations remain blocked unless separately approved by the owner.

Choose a model only after measuring the actual Windows host's CPU, RAM, GPU/VRAM, disk, and app workload. Pin both the primary and auxiliary/small models to local providers. The [OpenCode provider documentation](https://opencode.ai/docs/providers) notes that some workflows may use a separate small model for tasks such as session-title generation; choosing a local primary model alone is not proof that all inference stays local. Review providers, plugins, sharing, model discovery, and other network behavior for the exact OpenCode version. Verify outbound traffic before making any no-cloud/privacy claim. Block external inference endpoints unless Donald explicitly opts in. No silent cloud fallback.

Download required model weights once while online; verify that normal app operation remains responsive during inference. An offline host can continue local repository work and local tests, but GitHub reads/writes and remote CI require internet.

### 4. GitHub and secrets

Begin with GitHub read access only. If branch/PR support is added, the connector—not the model prompt—holds a repository-scoped, least-privilege credential. Separate read operations from write operations; require human confirmation before creating commits/pushing or opening a PR, and never give the agent repository-administration or deployment permissions by default.

Store credentials through Windows-protected storage (for example, Credential Manager or DPAPI under a dedicated account) behind a small local credential broker. Do not put tokens in Git, `.env` files the agent can read, OpenCode config, prompts, test artifacts, crash reports, or logs. Add secret-redaction tests. The previously exposed plaintext GitHub token must be revoked and replaced before any GitHub write integration; do not reuse or copy it.

### 5. Changes, tests, and review

When write mode is eventually enabled, use one isolated worktree and feature branch per task. Keep the production branch untouched. The agent may propose a patch and run approved checks; Donald reviews the diff and test results before any push or PR. CI must pass before merge. No autonomous merge, release, self-update, or production deployment is part of this MVP.

Use the repository's existing validation rather than inventing a parallel test framework. Select focused checks for the changed area, then confirm CI. Test the assistant itself with synthetic diagnostics and fake credentials; never copy real incident payloads or operational data into fixtures.

## Phased delivery

1. **Phase 0 — design and host inventory:** confirm the tool boundary and inventory Windows hardware, Docker/runtime setup, and available storage. No app or production changes.
2. **Phase 1 — local read-only prototype:** OpenCode + Ollama; repository Q&A and search only. Pin auxiliary model work locally too, audit outbound requests, verify offline startup after model download, and prove edits, shell execution, and GitHub writes are unavailable.
3. **Phase 2 — sanitized diagnostics:** add a small, read-only MCP bridge for approved health/sync/incident summaries. Test authorization, field allowlists, size limits, redaction, and prompt-injection resistance.
4. **Phase 3 — isolated patch workflow:** enable edits only within a temporary worktree, then approved test commands. Require owner review before commit/push/PR.
5. **Later, only if useful:** an authenticated local web interface, reviewer agent, or GitHub PR/check integration. These are not prerequisites for the first useful prototype.

## Phase 1 acceptance criteria

- OpenCode uses local primary and auxiliary models and can answer questions about a fresh repository checkout without sending source, prompts, or selected incident text to cloud inference.
- A network-egress check confirms which external endpoints the chosen OpenCode version contacts; any required outbound content path blocks the no-cloud acceptance until removed or explicitly approved.
- The agent cannot edit files, execute shell commands, read secrets, access production data, or write to GitHub.
- Model download is not part of ordinary app startup; a stopped/unavailable model does not take down the production app.
- Offline repository Q&A works after model files and dependencies are cached; GitHub/CI capabilities are clearly reported unavailable offline.
- A small synthetic test set checks grounded answers, malicious instructions embedded in source/incident text, and no-secret leakage.
- Host performance is measured with the app's normal services running; model choice and context size are based on measured headroom, not theoretical hardware capacity.

## Agent-owned execution

- **Objective:** build a private, owner-operated coding assistant for this repository, initially read-only.
- **Owner:** Donald Berg. **Affected surfaces:** future local developer tooling and a narrow diagnostics bridge; this initial change is documentation only.
- **Evidence/access paths:** `AGENTS.md`, `README.md`, `docs/local-ai-deployment.md`, `docs/self-host/README.md`, API health and incident routes, OpenCode provider/permission/skills/MCP documentation, and approved GitHub repository access.
- **User input:** host hardware and confirmation of any remote/LAN access are needed before model selection or network exposure. No secret is needed in chat.
- **Overlap:** existing app local-AI and self-host documentation describe product inference and app deployment; neither authorizes a coding agent or changes this plan's control-plane boundary.

## Applicable safeguards and verification

- Follow `AGENTS.md`, repository skills, branch/PR protection, and the AI delivery-governance decision to measure end-to-end quality rather than code-generation speed.
- Keep agent-facing diagnostics read-only, least-privilege, allowlisted, privacy-bounded, and independently tested. Preserve explicit human approval for secrets, security boundaries, GitHub writes, production operations, and releases.
- Do not claim the self-host deployment is production-qualified or this assistant has been implemented until the host and relevant validation matrix have actually passed. This document-only change does not run application tests or alter any application behavior.
- If a web UI is later added, validate desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari; distinguish emulation from physical-device evidence.
