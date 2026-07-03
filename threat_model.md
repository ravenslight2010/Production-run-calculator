# Threat Model

## Project Overview

This project is a pizza production planning and inventory system with a React web client, an Expo mobile client, and a production Express 5 + PostgreSQL API server. The production security boundary is centered on `artifacts/api-server`: clients are untrusted, the server enforces authentication and capability-based authorization, and shared operational data is persisted in Postgres.

Production assumptions for this scan:
- Only vulnerabilities reachable in production are in scope.
- `NODE_ENV` is `production` in production.
- Replit provides TLS for deployed traffic.
- `artifacts/mockup-sandbox` is development-only and should be ignored unless it is explicitly wired into production.

## Assets

- **User accounts and sessions** — username/password credentials, stateless session tokens, and password reset codes. Compromise enables impersonation and access to operational data.
- **Operational factory data** — live day-state, schedules, incidents, inventory, production rules, and saved sheets. Unauthorized reads or writes can disrupt production and expose business-sensitive information.
- **Privilege assignments** — roles and capabilities in `rolesTable` / `userRolesTable`. Compromise enables admin takeover, password resets, inventory changes, and incident review.
- **Facility AI memory and incident context** — shared facts, corrections, incident summaries, and other grounded context used across AI features. Poisoning, eviction, or disclosure can mislead operators, bias manager-facing AI guidance, or expose internal operational details.
- **Application secrets** — `DATABASE_URL`, token-signing secrets, and AI provider credentials. Leakage would allow database compromise, session forgery, or abusive third-party API usage.

## Trust Boundaries

- **Web/mobile client → API server** — all request bodies, headers, query params, and SSE connections are attacker-controlled until validated by the API.
- **API server → PostgreSQL** — the server has broad access to operational and auth data; injection or broken authorization at the API layer can become full data compromise.
- **Public → authenticated boundary** — `GET /api/healthz` and `/api/auth/*` are intentionally public. Production sign-up is gated by `STAFF_SIGNUP_CODE`, so authenticated low-privilege access should be treated as reachable by anyone who knows that shared onboarding secret or compromises an existing staff account.
- **Authenticated user → elevated capability boundary** — manager/supervisor/QC powers are enforced via `requireCapability`; failures here become privilege escalation.
- **Authenticated user → shared-operations boundary** — many live operational writes (for example `/api/sync` day-state updates and several daily inventory actions) are intentionally available to ordinary signed-in staff. Treat these as vulnerabilities only when the server exposes a capability boundary it claims to enforce, permits cross-scope access, or trusts attacker-controlled state beyond the intended operator workflow.
- **Live scope → sandbox scope boundary** — the seeded sandbox account is production-reachable and is supposed to stay isolated from live data and global admin state. Any bridge between these scopes is high risk.
- **API server → external AI provider** — AI routes send sanitized prompts to external services and must bound cost, input size, and sensitive data disclosure.
- **Authenticated user → facility-wide AI memory boundary** — low-privilege users can reach some routes that influence shared AI context. Any path that lets them read, poison, evict, or unduly bias facility-wide memory used in manager or worker prompts is security-sensitive.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/routes/index.ts`
- **Highest-risk areas:** `src/routes/auth.ts`, `src/middlewares/requireAuth.ts`, `src/middlewares/requireCapability.ts`, `src/lib/auth.ts`, `src/lib/roles.ts`, `src/lib/passwordResets.ts`, `src/lib/sandbox.ts`, `src/routes/sync.ts`, `src/routes/inventory.ts`, `src/routes/ai.ts`, `src/routes/aiMemory.ts`, `src/routes/incidents.ts`, `src/routes/incidentsAi.ts`
- **Public surface:** `/api/healthz`, `/api/auth/sign-up`, `/api/auth/sign-in`, `/api/auth/username-available`, `/api/auth/forgot-password`, `/api/auth/reset-password`
- **Authenticated/admin surface:** all other `/api/*` routes after router-level `requireAuth`; elevated routes are guarded per-handler with `requireCapability`. Since the sign-up secret may be shared among staff, authenticated-but-low-privilege routes should still be reviewed for abuse by insider or compromised-staff accounts.
- **Usually dev-only / out of scope unless proven reachable:** `artifacts/mockup-sandbox/**`, test files, local build scripts, and preview-only token-in-query handling guarded by `NODE_ENV !== "production"`

## Threat Categories

### Spoofing

The application relies on custom stateless session tokens plus username/password authentication. The server must reject forged, expired, or revoked tokens on every protected route, and public auth endpoints must resist account takeover through brute-force, predictable bootstrap behavior, or insecure recovery flows.

Required guarantees:
- Only legitimate users may establish sessions.
- Public auth endpoints must not allow trivial enumeration or online guessing that leads to account takeover.
- Password recovery and password changes must revoke attacker-held access, not just future logins.
- Any built-in/demo account must be impossible to use against production data.

### Tampering

Operators and managers can mutate schedules, inventory, production rules, aliases, incident state, and some AI-assisted operational data. Because clients are untrusted, every server-side write path must validate inputs and enforce business rules and capabilities on the server, not in the client.

Required guarantees:
- All writes must be validated server-side.
- Capability checks must be enforced on every sensitive mutation.
- Sync and inventory mutation paths must prevent unauthorized or conflicting updates from corrupting shared state.
- Facility-wide AI memory must not be writable in ways that let low-privilege users poison or suppress grounded behavior outside the intended product workflow.

### Information Disclosure

The API holds business-sensitive operational data and shared AI memory. Disclosure risks come from broken access control, sandbox/live boundary mistakes, overshared responses, public auth helpers, logs, and prompts sent to third-party AI services.

Required guarantees:
- Unauthenticated users must not learn sensitive account or operational state beyond what is explicitly intended.
- Low-privilege authenticated users must not be able to bulk-read protected facility-wide AI memory or manager-only operational context unless that access is intentionally granted.
- Sandbox users must never gain access to live data unless that exposure is explicitly authorized and protected.
- Logs, errors, and AI prompts must not expose secrets or data outside the intended audience.

### Denial of Service

Several public and authenticated routes are computationally or financially expensive, especially AI-backed endpoints and large sync/import payloads. Public auth endpoints are also attractive for password spraying and nuisance traffic.

Required guarantees:
- Expensive endpoints must have effective production rate limits and size bounds.
- Public auth and recovery endpoints must not allow unbounded automated abuse.
- Shared AI-memory stores and other bounded global state must not be cheaply floodable in ways that evict legitimate data or degrade service.
- External-service failures should degrade safely without taking the application offline.

### Elevation of Privilege

Managers and supervisors can assign roles, reset passwords, review incidents, and manage inventory. Any flaw in bootstrap logic, role assignment, password-reset approval, sandbox identity, or route-level capability checks can turn a normal or anonymous user into a privileged one.

Required guarantees:
- Privileged roles must only be granted through deliberate, authorized flows.
- First-user/bootstrap behavior must not let any holder of the general staff sign-up code seize manager control unintentionally.
- Delegated recovery capabilities must not become a path to take over higher-privilege accounts.
- Sandbox/demo features must not create a shortcut to manager-level powers in production.
