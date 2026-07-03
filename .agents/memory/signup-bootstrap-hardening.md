---
name: Sign-up bootstrap hardening
description: Access-code-gated sign-up, rate limiting, and the bootstrap-manager race fix on the self-contained auth system.
---

Public self-registration was hardened against three issues without adding new user-facing flows:

1. **Bootstrap-manager race.** "First registered user becomes a manager" was a check-then-insert race — two concurrent sign-ups could both become manager. Fixed with a Postgres advisory lock (`pg_advisory_xact_lock`) wrapped around the check-then-insert in a `db.transaction`, so role resolution for a brand-new user is serialized facility-wide.
   **Why:** the bootstrap manager grant is a security-sensitive one-time event; a race here is a privilege-escalation bug, not just a data race.

2. **No rate limiting on public auth endpoints.** Added a shared rate limiter (generous window: 20 req/60s) across sign-up, sign-in, username-available, forgot-password, and reset-password. Reuses the existing pluggable rate-limit store pattern (Postgres-backed in prod, in-memory otherwise) already used by the AI cost-cap limiter.
   **Why:** these endpoints are unauthenticated by necessity, making them brute-force/enumeration targets.

3. **Fully public self-registration exposed internal factory data.** Sign-up now requires a shared `accessCode` matched (timing-safe) against `STAFF_SIGNUP_CODE`. Sign-up is closed entirely (fails closed, not open) if the env var is unset — no auto-fallback. This is the same shared-secret pattern as the existing supervisor PIN, not a new auth flow.
   **How to apply:** the code is a plain string field on the sign-up request/form (`SignUpCredentials` in the OpenAPI spec), shown only in sign-up mode; 403 on mismatch. Web + mobile both gate on it identically. Any new sign-up call site (including tests) must pass `accessCode`.
