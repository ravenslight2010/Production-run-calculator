# Incident Tracking & Notification Delivery — Research & Improvement Opportunities

## Why This Pairing

This started as research into the incident-tracking/diagnosis system (not on the
backlog at all). Following it led directly to a second, closely-related finding — web
push notification delivery — because incidents turned out to be the clearest example of
a feature that *should* proactively notify someone and currently can't, for a reason that
turns out to be systemic rather than specific to incidents.

---

## Part 1: Incident Tracking & AI Diagnosis — Already Mature

Reading `.agents/memory/incident-diagnosis.md` alongside the actual code
(`artifacts/api-server/src/lib/incidents.ts`, `routes/incidentsAi.ts`,
`lib/incident-cluster/src/index.ts`) shows a genuinely well-engineered pipeline, in the
same league as auto-track and sync:

- Any authed user reports an issue (or an uncaught crash auto-captures) → persisted as
  an incident → AI gives a plain-language diagnosis + safe-recovery steps (explicitly
  scoped: "the AI cannot edit code" — fix means explanation + restart-type guidance, not
  an autonomous remediation)
- **Deterministic fallback clustering** (`buildFallbackClusters`) groups incidents by
  platform+screen when AI is unavailable — managers always get a useful grouping, never
  a blank screen, same fail-safe philosophy as the deterministic-first import design
- **History-aware diagnosis**: each report is grounded in similar past incidents via a
  signature-based match (`platform|screen|<sorted-deduped-tokens>`, Jaccard similarity,
  threshold ~0.34) and every diagnosis writes back to shared facility memory — so
  recurrence is tracked and surfaced (`IncidentRecurrence {count, lastWorkaround}`)
  without needing a human to notice the pattern themselves
- **Two dedicated prompt-injection/authorization-boundary defenses** found here directly
  strengthen the confidence level of the AI-system research doc (see the update added
  there) — `UNTRUSTED_FREEFORM_DOMAINS` (a reporter's free text never leaks into other
  AI features' "trusted fact" grounding) and `PRIVILEGED_FACILITY_DOMAINS` (a
  low-privilege user can't indirectly recover privileged data by asking an
  everyone-can-use AI route to "repeat what it knows")

**Bottom line**: like auto-track, this isn't a system needing redesign. The one real gap
is delivery — see Part 2.

---

## Part 2: Push Notifications Are Half-Built (the real finding)

**What exists**: `web-push@3.6.7` is a real, installed dependency.
`artifacts/api-server/src/routes/webPush.ts` exposes a working VAPID public key
endpoint and full subscription CRUD (`GET/POST/DELETE /web-push/subscriptions`) — a
client can genuinely subscribe to push today.

**What's missing**: nothing in the codebase ever calls `web-push`'s `sendNotification`.
The subscription infrastructure has no consumer. Concretely:
- **Incidents**: a new high-severity cluster, or an incident recurring for the Nth time,
  triggers nothing beyond appearing in the Incidents tab list — a manager only finds out
  if they happen to open it
- **Proactive alerts**: `proactiveAlertSettingsTable` exists and is referenced in
  `sync.ts`, but alert delivery rides the SSE/dayState sync channel — reaching only
  clients that are *already open and connected*. A manager whose device is asleep,
  backgrounded, or simply not on the app gets nothing, despite the settings table's own
  name implying proactive (not "only if you happen to be looking") delivery.

**Why this matters more than a generic "add push notifications" idea**: the
subscription-management half is already built and (per the schema/route names) was
clearly *intended* to back real alerting — this isn't a greenfield feature request, it's
finishing a feature that's already 60% done. The two most natural first consumers
(incident severity/recurrence, proactive alerts) already compute exactly the signal a
push notification would carry; they just don't call the one missing function.

**Recommendation**: 
1. Add a small `sendWebPush(userId, payload)` helper wrapping `web-push`'s
   `sendNotification`, iterating a user's stored subscriptions, pruning subscriptions
   that come back expired/invalid (410/404 from the push service — standard web-push
   hygiene, not something to skip)
2. Wire it into the two consumers that already compute the trigger signal:
   incident-severity/recurrence crossing a threshold, and proactive-alert firing
3. Respect the existing capability boundaries — incident push should follow the same
   `review-incidents` gate the rest of that system already uses; don't create a new,
   looser notification-specific authorization path

**Scope note**: this is deliberately narrower than "build a notification system" — the
system (subscriptions, VAPID, settings storage) already exists. This is specifically
about calling the one function that turns stored subscriptions into actual delivered
notifications.

---

## Code References
| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/incidents.ts` | Incident CRUD, status model |
| `artifacts/api-server/src/routes/incidentsAi.ts` | Diagnosis prompt + sanitize |
| `lib/incident-cluster/src/index.ts` | Deterministic + AI-assisted clustering |
| `artifacts/api-server/src/routes/aiMemoryContext.ts` | The two isolation mechanisms described above |
| `artifacts/api-server/src/routes/webPush.ts` | Subscription CRUD — has no send-side counterpart |
| `lib/db/src/schema/proactiveAlertSettings.ts` | Alert settings storage — currently SSE-delivered only |
| `.agents/memory/incident-diagnosis.md` | Full incident system write-up, including several sharp test-isolation gotchas worth reading before touching this code |
