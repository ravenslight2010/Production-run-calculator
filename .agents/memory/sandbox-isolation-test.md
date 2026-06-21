---
name: Sandbox isolation integration test
description: How the live↔sandbox scope-isolation integration test is wired, and why users are seeded once.
---

# Sandbox isolation integration test

`sandboxIsolation.integration.test.ts` proves live↔sandbox data-scope isolation end-to-end through the real router + `requireAuth` stack against a disposable Postgres DB (same harness as the other `*.integration.test.ts`).

**Seed users ONCE in `beforeAll`, never truncate users between cases.**
**Why:** `requireAuth` resolves a request's scope via `isSandboxUser(userId)`, which has a 15s in-memory cache and **no exported clear function** (unlike `clearUserValidityCache` / `clearSessionBoundaryCache`). If users were re-seeded per case, a stale cached scope keyed by an old id could misroute a request. Stable user identity keeps the cache correct.
**How to apply:** `beforeEach` truncates only the scoped DATA tables (daily_sync, production_rules, inventory_*), leaving users/roles/role-catalog intact. Drive both actors with `signToken(id)`: a plain live manager (scope live) and the seeded `test` user from `seedSandboxUser()` (scope sandbox).

**Boundary-pinned-to-live proof:** a reset boundary (`dayState.resetAt`) written via the sandbox session fences nobody (getSessionBoundaryMs reads the live row only); a boundary written via the live session 401s every session including the sandbox one. Always `clearSessionBoundaryCache()` after writing a boundary before asserting.
