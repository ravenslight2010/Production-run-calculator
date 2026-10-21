---
name: Incident reporting & manager review
description: How report-an-issue and crash capture are recorded and reviewed across web+mobile.
---

# Incident reporting & manager review

Any authenticated user can report an issue (or an uncaught crash can be auto-captured).
The server records the report for managers; it does not generate a diagnosis or
workaround and does not send a notification. Managers can review and manage incidents.

**Source of truth / where things live:**
- DB: `incidents` table in lib/db.
- Contract: OpenAPI `ReportIncidentInput`, `IncidentDiagnosis`, `Incident`,
  `IncidentContext`, `UnreviewedCount`; paths POST/GET `/incidents`,
  GET `/incidents/{id}`, POST `/incidents/{id}/review`, POST `/incidents/{id}/resolve`,
  GET `/incidents/unreviewed-count`.
- Server: src/lib/incidents.ts (CRUD), routes/incidentsAi.ts (validation, redaction),
  routes/incidents.ts (mount + auth/rate-limit).

**Status model (new → reviewed → resolved):** status is `new` | `reviewed` | `resolved`.
`resolved` IMPLIES reviewed — resolving sets `resolvedAt` AND backfills `reviewedAt`
(`existing ?? now`) so the unreviewed-count drops even when resolving a still-`new`
incident. Don't let a later "review" downgrade a resolved incident (review guard is
`if status !== "new" return`). Filtering (status/platform/source) is CLIENT-SIDE in both
tab components — no server query params. Keep web (IncidentsTab.tsx) + mobile
(incidents.tsx) filters and resolve buttons at parity.

**Auth rules (don't regress):**
- Reporting (POST /incidents) is open to ALL authed users — gated `requireRole` *operator*
  + a per-user rate limit. Auto-crash capture also posts here.
- Manager endpoints (list / get / review / unreviewed-count) are `requireRole` *manager*.

New reports are record-first and return null diagnosis, workaround, and recurrence
fields. Preserve the nullable historical fields and manager review behavior for
older persisted incidents.

**Crash capture:** both apps wrap the root in an ErrorBoundary whose `onError(error,
stackTrace)` fires a fire-and-forget `reportIncident({source:"auto_crash", ...})`.
A failed report must never mask the original crash — always `.catch(() => {})`.

**Parity:** web (artifacts/run-calculator: ReportIssueDialog, IncidentsTab,
ErrorBoundary, useUnreviewedIncidentCount) mirrors mobile (run-calculator-mobile:
ReportIssueModal, app/(tabs)/incidents.tsx, ErrorBoundary, useUnreviewedIncidentCount).
The mobile nav badge sums pending-reset + unreviewed-incident counts; the manager
"Reported issues" menu item is gated by `useMe().isManager`.

**Mobile gotcha:** expo-constants is NOT installed, so the mobile report path sends no
app version — don't reintroduce a `Constants`/appVersion import.

**Integration-test gotcha:** the POST /incidents per-user report rate limit uses an
in-memory store SHARED across the whole vitest file (non-prod), so accumulated
`seedIncident(OPERATOR)` calls eventually 429 → order-dependent failures. In new test
blocks seed via direct `db.insert(incidentsTable)` rather than the rate-limited POST.
For tests that MUST go through the rate-limited POST, mint a fresh disposable user
per test (insert user+role, clearUserValidityCache) so each one's single POST lands
within its own budget.

**Historical AI-memory privacy boundary:** older `"incidents"` facility-memory rows
may contain reporter-authored free text. Keep that domain excluded from every
general AI prompt, even for an explicit domain allowlist; do not add a writer or
history-based diagnosis path without a separate privacy and product review.
