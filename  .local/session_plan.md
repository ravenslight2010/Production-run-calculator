# Objective
Conduct a production-scope security scan across the entire project, prioritizing concrete exploitable weaknesses in the Express API server and ignoring dev-only surfaces unless production reachability is demonstrated.

# Relevant information
- Production entry points are `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`, and `artifacts/api-server/src/routes/index.ts`.
- Public routes are limited to `/api/healthz` and `/api/auth/*`.
- Everything else is behind `requireAuth`; elevated functions use `requireCapability`.
- The repo contains a seeded sandbox account and sandbox/live scope separation logic; this is a first-class trust boundary.
- `artifacts/mockup-sandbox/**`, tests, and preview-only behavior behind `NODE_ENV !== "production"` are out of scope unless proven reachable in production.
- Deterministic scans are available in notebook vars `sast` and `hounddog`; initial review shows mostly false positives and no HoundDog findings.

# Tasks

### T001: Validate public auth and bootstrap surfaces
- **Blocked By**: []
- **Details**:
  - Review `src/routes/auth.ts`, `src/lib/auth.ts`, `src/lib/passwordResets.ts`, `src/lib/roles.ts`, and auth-related middleware.
  - Focus on first-user bootstrap, built-in/demo accounts, sign-in/sign-up abuse resistance, username disclosure, and password reset abuse.
  - Acceptance: Confirm whether public auth routes allow account takeover, privilege seizure, or sensitive disclosure in production.

### T002: Validate live/sandbox isolation and privilege boundaries
- **Blocked By**: []
- **Details**:
  - Review `src/lib/sandbox.ts`, `src/routes/sandbox.ts`, `src/lib/requestScope.ts`, `src/middlewares/requireAuth.ts`, `src/middlewares/requireCapability.ts`, and role-management routes.
  - Focus on whether sandbox identity can be abused in production, whether live data can cross into sandbox, and whether capability checks can be bypassed or escalated.
  - Acceptance: Confirm or rule out privilege escalation / data exposure across the live↔sandbox and operator↔manager boundaries.

### T003: Validate shared-state, inventory, and high-value authenticated mutations
- **Blocked By**: []
- **Details**:
  - Review `src/routes/sync.ts`, `src/routes/inventory.ts`, related libs, and incident routes where any signed-in user can submit or modify state.
  - Focus on IDOR, broken function-level auth, unauthorized write paths, and state exposure through SSE or list endpoints.
  - Acceptance: Confirm whether authenticated low-privilege users can access or tamper with data outside intended permissions.

### T004: Validate AI/import/photo routes for production-impactful abuse
- **Blocked By**: []
- **Details**:
  - Review `src/routes/ai.ts`, `src/routes/incidents.ts`, and AI-adjacent helper routes that call external models or persist shared AI memory.
  - Focus on SSRF-like fetches, unsafe external calls, rate-limit gaps, prompt/input shaping that can disclose sensitive data, and capability mistakes.
  - Acceptance: Confirm whether AI routes expose secrets/data, bypass authorization, or permit meaningful cost/resource abuse in production.

### T005: Synthesize findings and prepare grouped vulnerabilities
- **Blocked By**: [T001, T002, T003, T004]
- **Details**:
  - Review scanner output, validate subagent findings, deduplicate, assign severity, and group by remediation area.
  - Update threat model if new durable scoping lessons emerge.
  - Acceptance: `.local/new_vulnerabilities/` is grouped and complete, with only real production-relevant findings.
