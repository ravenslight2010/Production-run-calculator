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

**Expiry/waste nudge wired in (server-only, auto-parity):** the proactive route
loads current expired/expiring-soon stock via `flagExpiringItems` (same DB load
as `/inventory/waste-insight`, grounded by `expirySoonDays`) and feeds it into
`buildProactivePrompt(input, flaggedAtRisk)` as an "AT-RISK STOCK" section. The
AI may surface a third kind of nudge — category `efficiency`, stable key
`stock-expiring` — but is told to prioritize behind-plan/break over it. No extra
AI call (folded into the existing one); the stock load is best-effort (failure →
empty list, never breaks the poll). No client change needed: both banners already
render `efficiency` and dedup by key, so web+mobile parity is automatic.

**Manager-tunable cadence/cooldown/on-off (factory-wide):** the 4min poll and
30min cooldown are no longer constants — they're a server-persisted single-row
setting (`proactive_alert_settings` id=1; `GET` open to any authed user, `PUT`
manager-only) editable from a "Proactive Alerts" card in the Inventory/Settings
area (web `InventoryTab`, mobile `inventory.tsx`), both manager-gated. Clamp/bounds
(poll 30–3600s, cooldown 0–86400s) live in the db-FREE `aiProactive.ts`
(`clampProactiveSettings`), NOT the db-bound `ai.ts`, so they stay unit-testable
without binding the pool (same rule as the integration-test DB-binding gotcha).
The hook now uses a recursive `setTimeout` (not `setInterval`) that re-`fetchProactiveSettings()`
each cycle, so cadence/cooldown/on-off changes take effect next cycle with no
reload; cooldown is read via a ref so the evaluate closure stays stable. When
disabled the timer keeps ticking on the DEFAULT cadence so a re-enable is picked
up. UI inputs are in MINUTES (persist as seconds). Web+mobile parity required.

**Idle-day backoff (cost saver):** on an idle day (no run in progress) the hook
polls at `idlePollSeconds(pollSeconds) = pollSeconds * PROACTIVE_IDLE_POLL_MULTIPLIER`
(4×), clamped to the same `PROACTIVE_POLL_SECONDS_MAX`. Active-day cadence is
unchanged. Decision is purely client-side (a multiplier, NOT a new server knob),
so no settings/migration change. The hook builds `OptimizeInput` ONCE per tick and
feeds the same snapshot to both `evaluate(input)` and the cadence choice; client
`isDayActive` mirrors the server's (`runs.some(status==="running")`) but must guard
`Array.isArray(runs)` since the client builds the input. Test parity: the shared
de-dup suite's `buildInput` must look ACTIVE (relies on per-poll base cadence);
idle cadence has its own test. Web+mobile parity required.
