# Local Coding Assistant for Production Run Calculator

**Status:** Phase 1 groundwork: a V2 read-only profile template and static invariant checker are prepared; OpenCode is not installed and host/runtime/outbound-traffic checks are not run. **Production direction:** self-host is the target; Replit is transitional until an explicit cutover. This work does not change the live app or authorize production cutover.

## Objective

Plan a private, owner-operated coding assistant on the semi-dedicated Windows host used for self-hosting. Use OpenCode as the initial coding agent and a local model runtime such as Ollama. The assistant should help maintain this repository, investigate selected app-reported problems, run approved project checks, and prepare reviewed GitHub changes.

This is a developer/operator tool, not an AI feature for floor or office users. The app's product local-AI integration is a separate system.

## Current baseline and direction

- The app already has a local-model adapter and optional Ollama Compose profile for product AI features (`docs/local-ai-deployment.md`, `docker-compose.local-ai.yml`).
- The Windows autoinstaller is responsible for checking host requirements and recommending a suitable model. Reuse its assessment instead of asking Donald for CPU/RAM/GPU/VRAM/disk details manually. The coding-agent model is distinct from the app’s product-AI model; validate it against the same host assessment and combined plant workload, with a no-coding-model fallback if fit or quality is not verified.
- The API exposes coarse health/readiness probes and a manager-protected `/health/diagnostics` route with sync-outbox and background-operation summaries (`artifacts/api-server/src/routes/health.ts`). Signed-in users can report issues/crashes, with manager review and correlation IDs (`artifacts/api-server/src/routes/incidents.ts`).
- The current self-host runbook is marked draft/not production-qualified. Treat that as work to finish, not a permanent ban on self-hosting. Replit remains the current production path until Donald explicitly decides to cut over; the self-host target is not qualified merely by this plan. See `docs/self-host/README.md` and `README.md`.
- This feature branch was created from `main`, while the current plant code is maintained on the Replit branch. Do not merge this branch into Replit or treat the branches as interchangeable without a deliberate comparison and integration plan.

## Boundaries

### Control plane separate from the production app

Run OpenCode and its model service on the host, initially for Donald on that machine only. Do not expose OpenCode, Ollama, shell access, or a coding-agent API to floor/office clients or the general LAN. Remote administration, if ever needed, requires a separately reviewed authenticated path; do not expose Ollama's model port to plant Wi-Fi.

Keep the agent checkout/worktrees, temporary files, and test database separate from plant containers, volumes, `.env` files, and operational data. The plant app must continue serving if the agent or model stops. The eventual installer option, if added, must be optional and off by default; production startup must not depend on it.

### Read-only start and bounded diagnostics

Phase 1 may read repository source and, only after a safe bridge is tested, a small diagnostics contract: readiness, build identity, bounded sync/background-worker summaries, and incidents explicitly selected for investigation. Do not give the agent direct database access, unrestricted host logs, private workbook blobs, or a production shell.

The existing detailed diagnostics and incident-review routes require elevated capabilities. Do not give the model a manager session and do not assume those routes are an appropriately scoped agent API. Add a separate least-privilege read-only identity/bridge with server-side method and path allowlists, field allowlists, result limits, and redaction. Never allow operational writes through the bridge.

Treat repository content, incident text, logs, external GitHub content, and model output as untrusted data rather than instructions. Test prompt-injection attempts using synthetic fixtures.

### OpenCode, models, skills, and network behavior

Use reviewed project skills from `.agents/skills` for coding, tests, incident triage, and PR preparation; do not auto-install unreviewed external skills. Start with explicit read-only permissions: reads/search allowed, edit and shell denied, write-capable GitHub tools absent. OpenCode permissions support allow/ask/deny rules; use the current version's schema and do not rely on permissive defaults. See [OpenCode permissions](https://opencode.ai/docs/permissions), [skills](https://opencode.ai/docs/skills), and [MCP servers](https://opencode.ai/docs/mcp-servers).

Do not ask Donald to provide host specifications manually. Consume the Windows autoinstaller’s host assessment/model recommendation, then validate the coding candidate under the expected plant workload. The coding-agent model is distinct from product local AI; account for combined resource demand and allow a no-model fallback if fit or coding quality is not verified. Pin both the primary and auxiliary/small model to local providers. OpenCode's [provider docs](https://opencode.ai/docs/providers) note that some workflows may use a separate small model for tasks such as session-title generation; selecting a local primary model alone does not establish that all inference is local. Review plugins, sharing, provider configuration, model discovery, and other network behavior for the exact installed version. Record an outbound-traffic inventory before claiming no-cloud operation. Block external inference unless Donald explicitly opts in; never silently fall back to a cloud provider.

Download model weights while online, not during routine plant startup. Test that inference does not starve API/database resources. Offline repository work can continue with cached model/dependencies; GitHub and remote CI require connectivity.

### GitHub and secrets

Start without GitHub write access. If GitHub access is later enabled, use repository-scoped least privilege and keep credentials in a protected credential store/tool host, not in model context or unrestricted shell environment. A local GitHub connector should expose only approved operations. If using `gh`, do not give a model unrestricted shell access to a process that can reveal its credential. Require owner approval before commit/push/PR; Donald remains the merger and production deployer. No repository-admin or deployment permissions by default.

Use Windows Credential Manager or DPAPI behind a narrowly scoped broker for host credentials; SOPS/age may be evaluated for encrypted configuration, but plaintext secrets must never enter Git, prompts, skills, test artifacts, crash reports, or logs. The previously exposed plaintext GitHub token must be revoked and replaced before any GitHub integration; never reuse or copy it.

### Changes, tests, and production updates

After the read-only pilot passes, use one disposable worktree and feature branch per task. Allow only reviewed test commands; block force-push, merges, production migrations, and deployment. Human review and passing CI precede any PR merge. Human approval is required for every plant image/Compose change or production update. The target update path is GitHub to the self-hosted plant, not an autonomous agent deployment.

The self-host cutover is a separate explicit owner decision. At minimum, close the host qualification checklist: verified backup and restore, tested update-from-GitHub and rollback, stable single-API operation, local/offline behavior, and mixed-device tablet/phone/desktop smoke tests. Replit may remain a transitional fallback or staging reference during that work.

## Phased delivery

1. **Phase 0 — design and installer handoff:** maintain this plan and define how the coding assistant consumes the Windows autoinstaller’s host assessment/model recommendation. Verify that the recommendation covers coding-agent needs, normal plant workload, and no-model fallback. No runtime agent or production changes.
2. **Phase 1 — local read-only pilot:** OpenCode + Ollama in the isolated agent directory; repository Q&A only. The branch now contains a current-V2 policy template and static invariant checker; the model ID must come from the autoinstaller’s recommendation and still requires an on-host runtime check. Audit egress, verify actual tool denials, and prove no edits, shell, GitHub writes, or plant data access before calling this phase passed.
3. **Phase 2 — diagnostics and tests:** add a narrow read-only MCP/HTTP bridge for approved health/sync/incident summaries; then allowlisted tests in the disposable worktree. Test authorization, redaction, size bounds, injection resistance, and resource impact.
4. **Phase 3 — reviewed GitHub workflow:** enable scoped branch/PR preparation through a restricted connector; owner reviews and merges. No autonomous deployment.
5. **Phase 4 — self-host operation/cutover:** finish and rehearse the separate self-host qualification, updater, backup/restore, tablet smoke, and rollback work. Cutover only by explicit owner decision.
6. **Optional later:** authenticated remote admin UI or incident-to-agent workflow. Neither is needed for the first useful pilot; installer inclusion stays optional/off by default until proven.

## Phase 1 acceptance criteria

- OpenCode can answer grounded questions about an isolated checkout using local primary and auxiliary models.
- Egress is measured for the exact OpenCode version; no source, prompts, or selected incident content goes to cloud inference. If an unavoidable content path exists, the no-cloud acceptance fails until disabled or explicitly approved.
- Edit, shell, secret reads, production data, and GitHub writes are unavailable in the Phase 1 permission profile.
- Stopping/unavailable local AI does not take down the plant app; model pulls are not part of ordinary startup.
- Cached local repository Q&A works offline; GitHub/CI unavailability is explicit.
- Synthetic fixtures verify grounding, prompt-injection resistance, secret redaction, and tool denials.
- Host load is measured while normal plant services run; model/context decisions use measured headroom.

## Agent-owned execution

- **Objective:** build a private coding assistant supporting self-host as the long-term production path, initially read-only.
- **Owner:** Donald Berg. **Affected surfaces:** local developer tooling, optional diagnostics bridge, and later operator documentation; production cutover is separate.
- **Evidence/access paths:** `AGENTS.md`, `README.md`, `docs/local-ai-deployment.md`, `docs/self-host/README.md`, API health/incident routes, reviewed OpenCode docs, and approved GitHub repository access.
- **User input:** no manual hardware inventory is needed; the Windows autoinstaller should assess the host and recommend a suitable model. Remote/LAN access still requires an explicit decision. No secret is needed in chat.
- **Overlap:** product local AI and self-host deployment docs cover distinct systems. This plan does not change either runtime or merge this documentation branch into the current Replit branch.

## Applicable safeguards and verification

- Follow `AGENTS.md`, the project AI-delivery governance, branch/PR protection, and relevant skills. Measure end-to-end usefulness, not code-generation speed alone.
- Keep diagnostics least-privilege, read-only, allowlisted, bounded, privacy-filtered, and independently tested. Preserve owner approval for secrets, GitHub writes, security boundaries, migrations, production updates, and cutover.
- Do not claim self-host qualification or assistant implementation before the actual host and required checks pass. This plan alone does not execute app tests or alter app behavior.
- Any future web UI needs desktop, phone, tablet portrait/landscape, Chromium/Chrome, and WebKit/Safari coverage; emulation is not physical-device proof.

