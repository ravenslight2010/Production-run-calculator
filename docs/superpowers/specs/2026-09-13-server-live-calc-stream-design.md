# Server Live-Calc Streaming (Slice 1)

## Context

The shared calculation engine (`lib/live-calc`) already exposes `computeCalc`
(client) and `computeServerCalc` (server). The server computes an
`operationalProjection` and streams `serverCalc` inside sync payloads; the web
client (`LiveRunContext.tsx`) adopts that server calc **only** when the
operational snapshot is in the `confirmed` display state. During the live/
streaming window — and offline — the client reruns `computeCalc` locally every
clock tick (per second), which is the heaviest remaining client-side math and
a battery cost.

Slice 1 closes the live gap: when online, the server becomes the calc authority
for the active run at a low cadence, and the client stops recomputing
time-varying math locally while the server tick is fresh. The existing local
`computeCalc` path stays as the offline fallback.

## Approved approach

No new REST `/run-calc` endpoint. Extend the existing operational sync path:

1. **Server tick emission.** While the day state has an active (un-ended) run,
   the operational sync stream emits a `serverCalc` tick (existing
   `ServerCalcResult` shape: `{ runId, calc }`) on the SSE channel at a 5s
   cadence, and immediately on run start/end/value changes. Idle (no active
   run) emits nothing new.

2. **Payload contract.** Reuse `ServerCalcResult` untouched. No day-state shape
   changes; the tick is additive to the existing operational payload
   (`operationalProjection`, `serverCalc`, `capturedAtServerMs`).

3. **Client adoption.** `LiveRunContext` adopts the server calc whenever:
   - online, and
   - `currentRunId === tick.runId`, and
   - the tick is fresh (received within the last 2 tick intervals, tracked by
     `capturedAtServerMs` / receipt stamp).
   Between ticks, time-dependent fields extrapolate locally from
   `capturedAtServerMs` (the same anchor `confirmedProjection` already uses);
   non-time fields stay fixed until the next tick. Local `computeCalc` runs
   only when offline or when the tick is stale (2 missed ticks → instant local
   fallback, no blank UI).

4. **Hard stop conditions.** Adoption is cancelled when the run ends, when the
   reset epoch advances, or when The SSE reconnects and misses the freshness
   window. The existing LWW/reset guards in `sync-invariant-check` §1/§5 apply;
   the tick is a read-only derivation and never writes day state.

## Tests

- **Server:** unit test for tick emission cadence (active run → tick emitted,
  no active run → none), payload shape unchanged (`ServerCalcResult`), and
  stop-on-end/reset.
- **Client:** adopt-when-fresh (uses server calc, skips local recompute),
  fallback-when-stale/offline (local calc, no blank), extrapolation between
  ticks stays within the existing `state-accuracy-check` tolerance, and run
  switch cancels adoption.
- **Regression:** `sync-invariant-check`, `state-accuracy-check`, and the
  operational snapshot suites stay green.

## Alternatives considered

- **New `/run-calc` endpoint + second SSE channel:** duplicates auth, client
  registry, reset-epoch scoping, and adoption logic; rejected.
- **Per-second full `Calc` pushes:** simplest but raises network use, which is
  a stated constraint; rejected in favor of 5s cadence + local extrapolation.
- **Delta-only tick payload:** possible follow-up if payload size shows up in
  soak metrics; out of scope for slice 1.

## Out of scope (later slices)

- Setup-form calcs (yield, batch needs, dough supply) to the server.
- Ingredient/consumption sums beyond what server snapshots already provide.
- Mobile parity.

## Rollback

Client and server stay coupled to one new emission path. Revert = remove the
tick emission on the server and return client adoption to the current
`confirmed`-only gate; both changes are small, independent commits on the
feature branch.
