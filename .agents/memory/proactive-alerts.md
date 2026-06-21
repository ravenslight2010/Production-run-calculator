---
name: Proactive shift alerts
description: Server-evaluated, client-deduped single nudge surfaced while a day runs (companion to on-demand optimize)
---

Proactive companion to the on-demand Shift Optimization Assistant: while a day is
running, clients poll `POST /ai/proactive-alert` on a cadence; the server returns
at most ONE alert (or null). Manager-only, rate-limited, grounded by shared
facility memory.

**Key design decisions:**
- Separate endpoint, NOT an extension of `/ai/optimize` — different response
  shape (single nudge vs. list) and cadence — but it reuses the identical request
  body via `validateOptimizeBody` / `OptimizeInput`.
- The server returns a stable `key` (slug naming the KIND of nudge, e.g.
  `behind-plan`, never run/timestamp specific). The CLIENT owns de-dup + cooldown:
  same key as current alert → skip; key dismissed within 30min → suppress; any
  other key surfaces next poll. Poll ~4min while active.
- "Active day" gate = at least one run with `startedAt && !endedAt`.
- Dismissals are recorded best-effort through the shared facility-memory write
  path (`saveFacilityKnowledge`, domain `proactive-alerts`, key
  `dismissed:<alert.key>`); server records triggers (key `trigger:<alert.key>`).

**Parity placement (must mirror):** the polling hook must live in a PERSISTENT
spot, not in the assistant tab/screen (those unmount). Web: hook in `home.tsx`,
banner above `<Tabs>` inside `<Form>`. Mobile: hook + banner in
`app/(tabs)/_layout.tsx` (RunContextProvider wraps it, so `useRun()` works there).

**Why:** Radix `TabsContent` unmounts inactive tabs on web; a hook mounted only in
the assistant tab would stop polling the moment the manager navigates away.
