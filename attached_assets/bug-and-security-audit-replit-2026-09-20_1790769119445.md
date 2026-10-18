# Bug & Security Audit — Replit (primary)

**Branch:** `Replit` (production)  
**Site:** https://lucias-production-assistant.replit.app/  
**Date:** 2026-09-20  
**Scope:** Code review + threat model + live health probe. Not a full penetration test or authenticated floor soak.

`main` is treated as experimental and is out of scope except where it informs risk.

---

## Executive summary

| Area | Assessment |
|------|------------|
| **Auth fundamentals** | Solid: scrypt passwords, HMAC session tokens, httpOnly cookies, auth rate limits, capability matrix with inventory tests |
| **Authorization** | Generally strong: mutation authorization inventory forces classification of writes; destructive ops capability-gated |
| **Input / DoS** | Sync 512KB cap + sanitize; AI routes rate-limited; rate-limit store fails to memory (not open) |
| **Sandbox** | Public `test`/`test` blocked when `NODE_ENV=production` |
| **Biggest operational risks** | Autoscale downtime; readiness couples AI/background to “up”; sync stale-complete overwrite |
| **Biggest security residual risks** | Shared staff signup code; long-lived sessions (30d); any operator with write capability can LWW-clobber peers; AI prompt/data leakage to providers |

Nothing in this review looks like an obvious unauthenticated RCE or open admin endpoint. Residual risk is mostly **shared-secret onboarding**, **session lifetime**, **multi-writer trust**, and **platform availability**.

---

## Part A — Security

### A.1 Strengths (keep)

| Control | Evidence |
|---------|----------|
| Password hashing | `scrypt$salt$hash`, `timingSafeEqual` verify (`lib/auth.ts`) |
| Session tokens | HMAC-SHA256, exp + iat, secret required at runtime |
| Cookie | `httpOnly: true`, `sameSite: "lax"`, `secure` in production |
| Auth rate limit | Public auth endpoints; Postgres store in prod, memory fallback (not fail-open unlimited) |
| Forgot-password | Always 200 — no username oracle |
| Capability model | Explicit capabilities; `requireCapability` + route inventory tests |
| Sandbox isolation | `sandboxAllowed()` false in production; sign-in rejects sandbox account |
| Sync hardening | `sanitizeSyncPayload`, size cap, key allowlisting (threat model ✓) |
| CORS | Production does not reflect arbitrary origins; credentials only for allowlisted hosts |
| Session fences | Daily `resetBoundaryAt`, password-change invalidation |
| Threat model | In-repo; many guarantees marked implemented |

### A.2 Findings

#### S1 — Shared staff signup code (medium)

Anyone who knows `STAFF_SIGNUP_CODE` can create accounts (then limited by default **operator** role with no capabilities). Risk is account sprawl, nuisance, and any future bug that elevates new users.

**Mitigations already:** rate limit; new users not managers by default (verify bootstrap still cannot self-promote).

**Recommendations:** rotate code periodically; prefer invite-only or manager-created accounts for production; monitor sign-up rate.

#### S2 — 30-day session TTL (low–medium)

`SESSION_TTL_SEC = 30 days`. Stolen token (XSS on non-httpOnly storage on mobile Bearer, device theft) stays valid a long time. Web cookie is httpOnly (good). Mobile Bearer in app storage is the weaker leg.

**Recommendations:** shorter TTL + refresh; revoke-all on password change (already); consider idle timeout for shared tablets.

#### S3 — Bearer token in `Authorization` (accepted risk)

Required for mobile/SSE. Ensure clients never put tokens in query strings or logs. Correlation IDs should not include tokens (appears intentional).

#### S4 — Multi-writer trust / insider clobber (medium product-security)

Any authenticated user who can PUT day-state can participate in LWW. A stale complete write with a high client stamp can overwrite peers (logic bug + integrity). Not classic “auth bypass,” but **integrity of operational data**.

**Recommendations:** baseRevision / baseSnapshotId on complete writes; see bug B1.

#### S5 — AI data exfiltration to third parties (medium, by design)

AI features send operational context to Gemini/OpenAI. Threat model flags facility memory poisoning and disclosure.

**Recommendations:** capability `use-ai-tools`; minimize payloads; no secrets in prompts; document what leaves the facility.

#### S6 — Readiness / availability as security-adjacent (low)

Taking the API “down” via missing AI key or background flaps is availability (DoS by misconfiguration). Separate uptime brief covers this.

#### S7 — CSRF on cookie auth (low for same-site)

`sameSite=lax` + same-origin production web reduces CSRF. Cross-site POST with cookies is limited. State-changing JSON APIs still rely on CORS not reflecting foreign origins (implemented).

#### S8 — Reset codes (low if managers careful)

8-char unambiguous alphabet, hashed at rest, 30 min, manager-gated issuance — reasonable. Risk is social (manager reads code aloud).

### A.3 Threat model alignment

Documented guarantees marked done include: capability on destructive mutations; sync sanitize/size; AI rate limits; rate-limit fallback not fail-open; sandbox scope isolation. Continue enforcing the **mutation authorization inventory** test on every PR so new routes cannot ship ungated.

### A.4 Security checklist for production secrets

- [ ] `AUTH_TOKEN_SECRET` / `SESSION_SECRET` strong and unique  
- [ ] `STAFF_SIGNUP_CODE` rotated; not a trivial value  
- [ ] AI keys present only if needed; not in client bundles  
- [ ] `NODE_ENV=production` on published deploy (sandbox gate depends on it)  
- [ ] DB not publicly reachable without auth  

---

## Part B — Bugs / reliability / correctness

### B1 — Stale complete sync can overwrite newer plant state (high)

**Class:** Data integrity / multi-device  
**Where:** Day-state PUT complete path — no base precondition; LWW by client `runValuesUpdatedAt`  
**Symptom:** After reconnect, old tablet data wins because stamp is “newer”  
**Status:** Design hole confirmed in research; needs regression test + baseRevision/snapshot fence  

### B2 — Day-state PUT does not increment `canonicalRevision` (medium)

Operational intents bump revision; ordinary form PUTs often do not. Peers cannot order day-state with revision alone.

### B3 — Autoscale / cold start downtime (high ops)

`.replit` `deploymentTarget = "autoscale"`. Live site was healthy on probe but intermittent “down” matches scale-to-zero / cold start. Prefer Reserved VM.

### B4 — Readiness requires AI + healthy background workers (medium ops)

`/api/readyz` 503 if AI unset or background degraded. Can mark deploy unhealthy. Soft-fail recommended (uptime brief).

### B5 — Empty form + real stamp wipe (mitigated in client)

Client guards against pushing all-default form with real stamp; regression risk if push paths bypass guard.

### B6 — SSE multi-instance fanout (medium when scaled)

In-process client set; Autoscale multi-instance → missed live events. Single always-on instance until bus exists.

### B7 — Inventory still largely plan-based (product)

Overproduction / mix deductions incomplete per plans — inventory drifts (correctness vs physical).

### B8 — Import multi-entity apply not one transaction (medium)

Partial apply possible mid-import.

### B9 — Pool 900ms acquisition (low–medium under DB pressure)

Can surface as flaky errors if DB is slow/sleeping; less of an issue on warm always-on DB.

### B10 — Open bug tracker

`.agents/memory/claude-bugs.md` style notes show historical fixes (e.g. authorization matrix accuracy). No large open critical list was fetched as currently non-empty “Open Bugs”; treat as incomplete without full agent memory scan.

---

## Part C — Live site (same day)

At probe time, https://lucias-production-assistant.replit.app/ :

- livez **200**, readyz **200**, all checks ok  
- Unauthenticated API **401** (expected)  

So: not permanently broken; intermittent issues more likely deploy/sync than total process death.

---

## Part D — Recommended fix order (Replit only)

| Priority | Item | Type |
|----------|------|------|
| P0 | Always-on deploy (Reserved VM) | Ops |
| P0 | Soft readiness (AI/background not 503) | Security-adjacent / ops |
| P0 | Sync complete-write base fence + test | Bug / integrity |
| P1 | Revision bump on day-state write | Bug |
| P1 | Signup code hygiene + monitor | Security |
| P2 | Session TTL / shared-tablet policy | Security |
| P2 | Inventory actuals / surplus | Product correctness |
| P2 | Import apply atomicity / undo | Bug |

---

## Part E — What this audit did not cover

- Authenticated multi-user adversarial testing  
- Full XSS review of every React surface  
- Dependency CVE audit (`pnpm audit` in CI is the ongoing gate)  
- Mobile app binary storage of Bearer tokens  
- Infrastructure IAM / Replit account security  

---

## Part F — Handoff snippet for Replit agent

```text
Primary branch: Replit. Production: lucias-production-assistant.replit.app.

Security: auth/crypto/capabilities look intentional and tested; residual risks are
shared signup code, 30d sessions, multi-writer LWW integrity, AI third-party data.

Bugs to prioritize:
1) Always-on deploy (not autoscale)
2) readyz must not 503 on missing AI or background-only failures
3) Complete day-state PUT needs baseSnapshotId/baseRevision fence + regression test
   for future-stamped stale overwrite

Do not treat main as release; experimental only.
```

---

*End of audit.*
