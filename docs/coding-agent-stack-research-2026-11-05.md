# Research: Local Coding Agent Stack for Production Run Calculator

**Context:** Owner's revised direction is self-host as the target production path; Replit remains transitional until explicit cutover. This single copy consolidates the two identical research attachments. Research findings are proposals, not enabled permissions or deployed features.

## Requirements and recommendation

| Need | Recommended approach |
|---|---|
| Open-source coding agent | OpenCode as the first pilot; consider Aider later for focused Git-native edits if OpenCode is insufficient. |
| App logs, diagnostics, feedback | A small allowlisted diagnostics MCP/HTTP bridge; no production shell or arbitrary SQL. |
| Read-only live app access | Separate least-privilege agent identity and exact GET allowlist, not a manager session. |
| GitHub features | Read-only first; later a repository-scoped connector for branches/PRs/check status. Human merges. |
| Safe secrets | Windows Credential Manager/DPAPI via a broker; evaluate SOPS/age for protected files only if useful. Do not place credentials in prompts or give unrestricted shell access to a token-bearing process. |
| Skills and tests | Reuse reviewed repo `AGENTS.md` / `.agents/skills`; allowlist checks in a disposable worktree and test the bridge with synthetic data. |

OpenCode V2 supports local providers such as Ollama, reusable skills, permission rules, and local/remote MCP tools ([V2 providers](https://opencode.ai/v2/docs/providers), [V2 skills](https://opencode.ai/v2/docs/skills), [V2 permissions](https://opencode.ai/v2/docs/permissions)). The current V2 format uses an ordered `permissions` array with `action`, `resource`, and `effect`; V2 actions include `shell`, `edit`, and `subagent`. The object-shaped `permission` map and actions such as `bash` are V1 syntax, not the native V2 form. In V2, legacy `small_model` has no native effect; use `agents.title.model` for the title-generation model ([V1 migration guide](https://opencode.ai/v2/docs/migrate-v1)).

The starter profile at [`docs/coding-assistant/opencode-readonly.example.json`](coding-assistant/opencode-readonly.example.json) pins the primary and title models to a custom loopback Ollama endpoint, denies edit/shell/web/MCP/plugin/skill access and restricts inference to the loopback provider, while keeping repository reading/search only. It does not block arbitrary process egress. Its static invariant check is `node scripts/coding-assistant/check-readonly-profile.mjs`. This is not an OS sandbox or proof of zero egress: runtime permission behavior and outbound traffic still need testing on the qualified Windows host, with a system-level policy and host firewall boundary.

## What the app already provides

- `/api/livez`, `/api/readyz`, `/api/healthz`, build identity, and a manager-protected health diagnostics response with bounded health checks and background/sync information (`artifacts/api-server/src/routes/health.ts`).
- Signed-in incident/crash reporting and manager-only review with correlation IDs (`artifacts/api-server/src/routes/incidents.ts`). The report path is record-first; it does not generate a diagnosis or send notifications.
- A local model adapter and Ollama Compose overlay for product AI features (`docs/local-ai-deployment.md`, `docker-compose.local-ai.yml`). This is not the coding agent.

## Proposed diagnostics bridge

```text
OpenCode (local, read-only profile)
     │ MCP over local process or loopback only
     ▼
Agent diagnostics bridge (new, narrow principal)
     ├─ readiness/build summary
     ├─ bounded sync-outbox/background-worker aggregates
     ├─ incident records explicitly selected for investigation
     └─ optional capped, redacted log slice

No arbitrary SQL, writes, full request headers/cookies, secrets,
private workbook content, unrestricted Docker/host shell, or general DB access.
```

The existing detailed health and incident review routes require elevated capabilities. Before using them, add a distinct read-only capability or service identity; never pass a manager credential to the model. Filter data server-side, set result/size limits, redact before tool output, and include correlation IDs only where useful. A user-selected incident should be an explicit opt-in path, not an automatic feed of all staff reports.

## GitHub and offline behavior

- Phase 1: no GitHub write integration. Repository work and local tests can run offline once code, dependencies, and models are cached.
- Later: a restricted connector may read repo/PR/check information and prepare a feature branch or PR. Scope any credential to this repository and only necessary permissions. Use a brokered MCP/API tool instead of exposing token-bearing environment variables to an unrestricted coding shell. Deny `force push`; require Donald's approval before push/PR, and keep merge/deployment human-owned.
- When offline, clearly disable/mark GitHub and CI capabilities unavailable; do not stall or disable the plant app.

## Secrets and privacy

- Keep plant `.env`, database credentials, session-signing material, TLS CA private key, and model-provider secrets outside the agent checkout and model context.
- Windows Credential Manager/DPAPI can protect credentials at rest; a broker should release only the credential needed for one approved connector operation. SOPS/age is an optional encrypted-file workflow, not a reason to give the model a decryption key.
- Redact secrets from process output, diagnostic responses, tool logs, screenshots, and test artifacts. Use fake credentials and synthetic incidents in tests.
- The previously exposed plaintext GitHub token is compromised: revoke it and create a new narrowly scoped credential before any integration.

## Skills, tests, and evaluation

Reuse existing project skills only after review. Candidate tasks: repository Q&A, sync reconnect diagnosis, interpreting health/outbox status, test planning, and PR drafting. The first profile should allow only reads/search and optionally ask before loading a skill; deny edits, shell, subagents, network fetch, and GitHub writes.

For later patch mode, use a fresh/disposable worktree and test database. Allow a small explicit command set for focused tests, typecheck, and lint; block production Compose projects, destructive database commands, migration commands, and unrestricted host paths. Preserve the repo's current CI checks rather than weakening or duplicating them.

Build a small evaluation set (10–20 synthetic tasks) covering grounded file/path answers, diagnostics interpretation, malicious instructions embedded in incident/log text, secret-redaction, and denied tool calls. Measure correctness, evidence quality, false confidence, latency, memory/CPU impact, and whether the production app remains responsive. Compare an alternate model only if the first fails a measured need.

## Additional recommendations

1. Keep `C:\runcalc\plant` (production Compose, env, volumes) separate from `C:\runcalc\agent` (source checkout, OpenCode config, disposable worktrees/tests).
2. Do not expose Ollama/OpenCode on plant Wi-Fi; localhost-only is the initial boundary. Remote administration requires separate owner approval and authentication.
3. Audit all network egress. OpenCode may use an auxiliary/small model for tasks such as session-title generation; pin that model locally too and verify the exact installed version. No silent cloud fallback.
4. Limit inference resources and concurrency so the app/API is not starved. Shared Ollama is an option only after measuring combined load.
5. Treat self-host as the destination, but do not cut over until backup/restore, GitHub update/rollback, stable API, offline behavior, and mixed-device smoke tests pass. The current self-host runbook marks qualification as open; that is work to finish, not a permanent Replit gate.
6. Keep the coding assistant optional/off by default in any future installer, and never make the production app depend on it.
7. Do not merge this branch into the current Replit branch blindly. It was created from `main`; reconcile branch changes deliberately before any code integration or cutover.

## Suggested build order

1. Inventory Windows host specs and choose a local model based on measured headroom.
2. Set up OpenCode + Ollama in the agent directory; configure a read-only profile and local auxiliary model; audit egress.
3. Verify repository Q&A and permissions offline without diagnostics or GitHub write access.
4. Add/test the sanitized read-only diagnostics bridge.
5. Add allowlisted tests in a disposable worktree; then add brokered GitHub read/PR features with human approval.
6. Separately complete and rehearse self-host cutover requirements. Keep plant update/deploy human-controlled.

**Decision:** OpenCode + local Ollama is the preferred pilot, not an irrevocable stack choice. If the read-only profile, local egress boundary, or host performance does not pass, reassess before integrating it into the installer.

