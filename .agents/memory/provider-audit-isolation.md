---
name: Provider audit isolation
description: Keep bounded real-provider workbook retries independent of shared database outages without bypassing application safeguards.
---

For provider-only workbook audits whose original pass used isolated fixtures, use a fresh disposable local database and the normal authenticated application route. Do not require a shared database repair or push its schema merely to check provider recovery.

**Why:** Shared API startup can fail before contacting the provider and may run data heals. Repeating that startup confuses database readiness with provider availability and creates unnecessary shared-data risk.

**How to apply:** Preserve the original request/grounding scope; prove target SHA-256s, capability authorization, application cost limits, pacing, no Apply calls, and unchanged canonical table digests. Label evidence as fixture-database real-provider evidence, never proof of shared/production database recovery. Use an ephemeral designated-manager bootstrap code in the isolated runtime: ordinary staff onboarding correctly does not grant manager privileges. Allocate free ports because other task services may already own fixed ports.

Stop a bounded batch when its target-based health probe shows the provider is still unavailable. Keep every target explicitly unresolved, preserve safe request/error summaries, and do not spend calls on the remaining workbooks just to turn a known outage into repeated failures.

**Why:** Availability is a prerequisite for meaningful retry reviews; unchanged workbook contents and a functioning local API cannot repair an upstream outage.

**How to apply:** A later attempt stays in the same owning task, targets the immutable originally failed set, and preserves earlier attempt summaries. Do not replace a health-gated incomplete task with a recursive retry follow-up.

Do not infer a provider-wide outage from the parser's normalized HTTP 502 alone. Capture bounded upstream status/error categories and check already-approved backup availability before replacing the primary model or extending local timeouts.

**Why:** A stalled primary returned remote gateway deadlines while both existing backups were healthy. The parser's generic error response hid that distinction; a longer local timeout could not extend the upstream gateway's deadline.

**How to apply:** Keep raw provider bodies, URLs, headers, credentials, and recipes out of retained diagnostics. Preserve original request summaries, distinguish remote HTTP deadlines from local cancellation/timeout, and keep any failover within the existing model ladder and retry/cost bounds.

A successful tiny synthetic model probe proves basic reachability, not workbook-import readiness. Confirm recovery with a real failed source content through the authorized parser before releasing the remaining batch.

**Why:** A backup answered a one-token probe quickly but still hit upstream deadlines on full structured extraction; a later backup handled that workload successfully.

**How to apply:** Label synthetic probes separately from actual workload evidence. Do not replace source-based readiness checks or source/units review with a successful minimal response.

A configured Gemini gateway can report model unavailability as HTTP 400,
not only HTTP 404. Do not interpret every 400 as either a malformed customer
document or an eligible fallback.

**Why:** A bounded synthetic request received a model-availability 400 while
requests selecting existing backups answered. The status alone hid the
difference between an unsupported model and an invalid generation request.

**How to apply:** Retain only bounded status and fixed diagnostic categories,
never raw provider messages. Any routing repair must distinguish confirmed
model unavailability from unrelated 400 errors and preserve the approved
ladder, retry/cost limits, and real-source verification requirement. A generic
model label in a compatibility response is not actual-provider-model evidence.
