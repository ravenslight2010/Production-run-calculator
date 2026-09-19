# Auto-Track Coordination — Research & Improvement Opportunities

## Why This Is Its Own Doc

Auto-track (automatic case/skid/tray/batch/barrel counters that advance on their own
while a run is "running") is tied into the sync system — its claims ride the same
`dayState` payload, its state lives in the same date-keyed `daily_sync` row, and Section
13's server-side migration (live-calc streaming) is the same underlying architecture
shift. But it's a distinct enough subsystem, with its own protocol and its own decade of
hard-won lessons (`.agents/memory/autotrack-*.md`, `cross-channel-auto-track-claims.md`),
to warrant its own research pass rather than folding it into the sync plan.

## Current State — More Mature Than It Looks From The Backlog

There is no dedicated backlog entry for this system today; it only appears as a code
reference under Section 12 (Battery & Performance). That undersells it. Reading the
actual implementation (`artifacts/api-server/src/lib/autoTrackCoordination.ts`,
`autoTrackServerTicks.ts`, `lib/live-calc/src/autoTrackEngine.ts`) alongside the memory
files shows a genuinely sophisticated, already-correct distributed-coordination protocol:

- **11 independent channels** per run (`case`, `tray-consume/produce`,
  `batch-consume/produce`, `hopper`, `sauce-barrel`, 4× applicator batch), each with its
  own `generation` + `sequence` pair
- **Fencing tokens, textbook-correct.** `generation` is exactly Martin Kleppmann's fencing
  token pattern (see "How to do distributed locking," and Google's Chubby paper) — a
  monotonic epoch that invalidates a stale writer's claims the instant a new generation is
  established (run switch, pause/resume, End Run). `sequence` is the per-generation
  monotonic counter within that epoch. This is independently arrived at (or
  deliberately designed) as the same solution real distributed lock services converged on.
- **Storage-layer idempotency, also textbook-correct.** The real inventory side effect
  (sauce barrel consumption) doesn't rely on the in-memory coordination bookkeeping alone
  — `consumeSauceBarrelInTransaction` does a genuine `INSERT ... ON CONFLICT DO NOTHING`
  keyed by `${runId}:sauce-event:${eventId}` at the DB layer. This is exactly the
  "idempotency key + storage-layer enforcement" pattern that distributed-systems writing
  on this topic consistently recommends as the correct backstop *even when* you also have
  a lock/fencing mechanism (belt-and-suspenders: fencing prevents most double-application,
  the DB constraint makes it impossible regardless).
- **Server-authoritative, not client-computed.** Per `cross-channel-auto-track-claims.md`:
  "Synchronized browser clients are passive for every automatic channel. Only the server
  tick engine may apply automatic progress." This closes the entire class of bug where two
  awake/reconnecting devices race to apply the same delayed tick.
- **State is correctly bounded.** `autoTrackCoordination`/`autoTrackServerState` live
  inside the date-keyed `daily_sync.data` JSONB blob (confirmed via
  `lib/db/src/schema/sync.ts`), not a separate unbounded table — coordination state for a
  day's runs is naturally garbage-collected the way the rest of that day's sync payload
  is. (I checked this specifically since it looked like a plausible unbounded-growth risk
  at first glance; it isn't.)
- **Real production bugs, real fixes, well-documented.** The `autotrack-*.md` memory
  files read like a distributed-systems case study: incremental-not-absolute deltas (so a
  manual correction becomes the new baseline instead of being silently overwritten),
  fractional remainder carry (so sub-unit-per-tick consumption doesn't floor to zero
  forever), stale-delta guards after a long pause or SSE reset, foreground-reconciliation
  as an explicit sync boundary, and lifecycle-aware handoff across End Run (freezer drain
  continuing to count after a run ends). Every one of these was a real user-reported bug,
  not a hypothetical.

**Bottom line on current state**: this is not a system that needs a redesign. It's
already applying the correct, industry-validated pattern for the exact problem class it
solves. The improvement opportunities below are refinements, not fixes to something
broken.

---

## Improvement Opportunities

### 1. Observability into stuck/rejected channels (new — the main gap)
**What's missing**: with 11 channels × every currently-running run, all server-tick
driven with generation/sequence fencing, there's no visibility into a channel that's
overdue (`nextDueAt` long in the past, never successfully firing) or repeatedly rejected
(client and server disagreeing on generation ownership, silently dropping claims tick
after tick). `.agents/memory/sync-retry-storms.md` covers general sync write retries but
doesn't mention auto-track specifically — this is a distinct gap, not already covered.

**How**: emit a structured log/metric on claim rejection (channel, runId, reason: stale
generation | sequence mismatch | schedule not due) and on a channel whose `nextDueAt` has
been in the past for longer than N cadence periods without an accepted claim. Surface the
worst offenders in whatever the existing `DataHealthWorkspace`/sync-health pattern ends up
being (see the sync plan's "per-device sync health" item — this could be the same panel,
a different tab).

**Benefit**: today, a stuck channel (e.g., a run whose sauce-barrel counter silently
stopped advancing) would only surface as a floor-staff complaint days later, the same way
every bug documented in the memory files originally surfaced. Structured rejection/staleness
logging would catch the *next* one before a user has to report it.

### 2. Property-based testing for the claim/sequence state machine (new)
**What**: the `.agents/skills/` catalog was recently updated with a property-based
testing skill (per the `Replit` branch's "Add property-based testing license" commit).
This subsystem is close to an ideal fit for it: the memory files document a long tail of
subtle interaction bugs (remainder carry, baseline resets, effect-ordering, cross-
generation arbitration) that were each found individually via production bug reports —
exactly the class of bug that generative/property-based testing (random sequences of
pause/resume/manual-edit/run-switch/generation-change events, checked against invariants
like "counter never decreases while running," "no eventId is ever applied twice," "counter
never exceeds casesNeeded") tends to surface *before* a user hits them, rather than after.

**How**: model the channel state machine's inputs (tick, manual edit, pause, resume, run
switch, generation bump) as a property-based test using the newly-added skill, with the
already-known invariants (from the memory files) as the properties to check. This
wouldn't replace the existing hand-written unit tests (`autoTrackServerTicks.test.ts`,
`autoTrackCoordination.test.ts`, the `useAutoTrack.*.test.tsx` suite) — it would sit
alongside them as a broader net for interaction bugs those specific hand-picked cases
don't happen to cover.

**Benefit**: given how many of the documented bugs were genuinely subtle multi-step
interactions (e.g. the stale-delta bug requiring a long pause AND an SSE reset AND a
specific baseline state), a generative approach is well-suited to finding the *next* one
of these before it reaches a floor.

### 3. Name the pattern explicitly in code comments (small, cheap)
**What**: the code correctly implements fencing tokens and idempotency keys but doesn't
name them as such. A future engineer "simplifying" `autoTrackCoordination.ts` without
recognizing `generation`/`sequence` as a fencing-token pattern could easily weaken the
exact property that makes it correct (e.g., "just use the latest write" is the classic
mistake fencing tokens exist to prevent).

**How**: a short comment block at the top of `autoTrackCoordination.ts` naming the
pattern explicitly and linking to `cross-channel-auto-track-claims.md`, the same way
`lib/db/src/schema/users.ts` now explains *why* it's a functional unique index and not
`.unique()` — so the reasoning survives past the person who originally wrote it.

**Benefit**: cheap insurance against a well-intentioned future refactor reintroducing a
bug this system already paid (in production incidents) to fix once.

---

## What NOT To Do
Nothing here suggests changing the core protocol. Given the fencing-token/idempotency-key
design is already correct per the distributed-systems literature, the temptation to
"simplify" the generation/sequence bookkeeping (it looks complex) should be resisted —
the complexity is load-bearing, not incidental. The improvements above are additive
(observability, testing, documentation), not structural.

---

## Code References
| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/autoTrackCoordination.ts` | Channel/claim/generation types, the coordination protocol itself |
| `artifacts/api-server/src/lib/autoTrackServerTicks.ts` | Server tick engine — builds due claims from canonical state |
| `lib/live-calc/src/autoTrackEngine.ts` / `autoTrackSchedule.ts` | Shared scheduling/timing math (web, mobile, server all use this) |
| `artifacts/run-calculator/src/hooks/useAutoTrack.ts` | Web client — display + claim submission, passive per the server-authority rule |
| `artifacts/api-server/src/routes/inventory.ts` (`consumeSauceBarrelInTransaction`) | The DB-layer idempotency enforcement for the real inventory side effect |
| `.agents/memory/autotrack-over-provisioning.md` | Why decrements must be incremental + gated on run-satisfied |
| `.agents/memory/autotrack-remainder-carry.md` | Fractional remainder carry; effect declaration order |
| `.agents/memory/autotrack-stale-delta.md` | Pause/SSE-reset catch-up bug and its guard |
| `.agents/memory/autotrack-zero-seed.md` | One-shot dough counter seeding |
| `.agents/memory/cross-channel-auto-track-claims.md` | The core fencing/ownership protocol write-up |
| `.agents/memory/sync-retry-storms.md` | Related but distinct — general sync write retries, not auto-track claim rejection |
