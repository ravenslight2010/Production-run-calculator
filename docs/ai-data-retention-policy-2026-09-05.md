# Retired AI Data Retention Policy

**Policy version:** `retired-ai-retention-v1`  
**Effective date:** 2026-09-05

Cleanup is explicit, manager-triggered, scope-aware, run-marker-audited, repeatable, and all-or-nothing. The dry run is visible in Data Health before mutation. A candidate set above 500 records is refused rather than partially or silently changed. Reports and logs contain counts and policy metadata only, never generated text, photos, incident context, or user conversation content. Repeat runs enforce rolling 7-day and 30-day expiry as retained operational records age into eligibility.

| Domain | Rule | Operational reason |
|---|---|---|
| Private assistant conversation turns | Delete after 30 days | The retired assistant has no surviving consumer; the short window permits bounded export/review while minimizing personal free text. |
| Forecast, proactive-alert, incident, quality, and waste facility facts | Delete at approved cleanup | These are generated or redundant grounding facts for retired features. Correction aliases and import memory live in separate tables and are excluded. |
| Incident diagnosis and workaround | Keep on the incident, prefix as **Unverified generated text** | The incident, reporter context, human notes, assignments, and activity are operational history. Existing model hypotheses remain visible only with an explicit trust warning; new generation is stopped. |
| Confirmed quality records | Keep structured history; redact thumbnail after 7 days | Confirmation is operational audit history. The image is the most privacy-sensitive and storage-heavy field and is not needed after near-term review. Generated summary/issues remain advisory and unverified. |
| Photo count observations | Keep open drafts; after 30 days redact generated draft/photo metadata on applied or cancelled observations | Open drafts must remain correctable. Applied inventory lots, ledger entries, and product references are separate operational records and are never cleanup targets. |
| AI result cache | Keep normal TTL cleanup for retained import/resolution namespaces | Shared cache still serves retained AI extraction and matching; retirement cleanup must not remove retained-operation cache entries indiscriminately. |
| Correction aliases, denied matches, import aliases/evidence | Keep | These are confirmed operational learning and audit evidence, not optional assistant memory. |
| Human incident notes, activity, schedule/run/quality/inventory history | Keep | Normal operational history is outside this cleanup and remains authoritative. |

## Write-stop boundary

Conversation persistence and retired forecast/proactive/waste/quality facility-memory writes have no active caller and are rejected at the server boundary. Incident creation no longer calls a model, stores a generated diagnosis/workaround, or writes incident facility knowledge. Confirmed quality checks remain an operational workflow and may create a short-lived thumbnail; every generated summary and issue is visibly labeled unverified, and repeat cleanup redacts thumbnails once they are seven days old. Count-from-photo creation remains disabled at its entry-point boundary.

## Export and rollback posture

Managers can export or inspect records through their existing administrative/history surfaces during the retention window. Cleanup does not retain deleted payload copies because doing so would defeat the privacy rule. Each cleanup run marker records bounded counts only, and the latest run time is shown in Data Health. Protected operational records remain available and are not reconstructed from generated data.