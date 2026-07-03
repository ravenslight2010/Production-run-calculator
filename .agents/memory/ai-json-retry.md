---
name: AI JSON bounded retry
description: Shared bounded-retry convention for server AI routes that JSON.parse a model reply
---

# AI JSON bounded retry

Rule: any api-server AI route that JSON.parses a model reply and fail-safes to an empty result must go through the shared bounded-retry helper (`fetchModelJsonWithRetry`, in the api-server lib) instead of a one-shot parse — max 2 paid attempts, retry only on returned-but-malformed JSON, never on a thrown provider call (those still 502 immediately).

**Why:** the model occasionally truncates/malforms JSON mid-response; without a retry that transient flakiness silently reads to the user as "the AI found nothing" (empty import matches, empty photo identification, no forecast). Provider throws are not retried because they usually mean quota/outage, where a second paid call only adds cost.

**How to apply:** wire new JSON-parsing AI routes through the helper when an empty result is user-visible data loss. Skip it for advisory paths where a silent no-op is fine (reviewer verdicts, proactive alerts, narration routes that already fall back to raw text or a deterministic summary — retrying those just doubles cost for no user-visible gain). Route-test pattern: queue-based model mock, "first malformed, second good" per route; shared give-up/502 semantics only need pinning once since every route uses the same helper.
