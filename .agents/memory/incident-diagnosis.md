---
name: AI incident diagnosis & manager alerts
description: How report-an-issue + crash capture, server incidents, AI diagnosis, and manager review fit together across web+mobile.
---

# AI incident diagnosis & manager alerts

Any authed user reports an issue (or an uncaught crash is auto-captured) → a server
"incident" is persisted → OpenAI returns a plain-language diagnosis + safe workaround
shown back to the reporter → managers see an incident list + an unreviewed-count nav
badge and can mark reviewed.

**Source of truth / where things live:**
- DB: `incidents` table in lib/db.
- Contract: OpenAPI `ReportIncidentInput`, `IncidentDiagnosis`, `Incident`,
  `IncidentContext`, `UnreviewedCount`; paths POST/GET `/incidents`,
  GET `/incidents/{id}`, POST `/incidents/{id}/review`, GET `/incidents/unreviewed-count`.
- Server: src/lib/incidents.ts (CRUD), routes/incidentsAi.ts (prompt + sanitize),
  routes/incidents.ts (mount + auth/rate-limit).

**Auth rules (don't regress):**
- Reporting (POST /incidents) is open to ALL authed users — gated `requireRole` *operator*
  + a per-user rate limit. Auto-crash capture also posts here.
- Manager endpoints (list / get / review / unreviewed-count) are `requireRole` *manager*.

**The AI cannot edit code.** "Fix" = explanation + safe-recovery steps only
(e.g. restart). Out of scope: email/SMS/push, third-party monitoring.

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
