# Remaining Deep Dives — Claims, Import Apply, Factory KV, Release Graph

**Date:** 2026-09-19  
**Companion:** [domain-deep-dives-2026-09-19.md](domain-deep-dives-2026-09-19.md)

---

# A. Auto-track claim acceptance state machine

## A.1 Types

```text
Claim:
  version, runId, channel, generation, sequence, eventId,
  dueAt, nextDueAt, baseUpdatedAt, correctionGeneration?, mutations[]

ChannelState (stored under autoTrackCoordination.runs[runId][channel]):
  generation, sequence, nextDueAt, acceptedEventId?, acceptedRunValuesUpdatedAt?, updatedAt

Outcome: accepted | duplicate | stale | conflict
```

**Generation key (server):**  
`"${runId}:${metaUpdatedAt ?? startedAt ?? 0}"` — ties claims to a lifecycle identity. Pause/end/disable invalidate non-case channels; case channel has slightly different lifecycle rules.

## A.2 Acceptance algorithm (`applyAutoTrackClaim`)

```text
1. Lifecycle gate
   expectedGeneration == claim.generation
   AND run.startedAt finite
   AND not autoTrackDisabled
   AND (case channel OR (not paused AND not ended))
   → else outcome = stale

2. Same generation as previous channel state?
   YES:
     same sequence + same eventId → duplicate
     claim.sequence <= previous.sequence → stale
     claim.sequence != previous.sequence + 1 → stale  (must be contiguous)
   NO (new generation):
     claim.sequence must be 1 else stale

3. Base stamp check (if still accepted)
   If runValuesUpdatedAt[runId] != claim.baseUpdatedAt:
     Allow only if currentUpdatedAt equals some channel's acceptedRunValuesUpdatedAt
     (another auto-track channel advanced the stamp)
     else → conflict  (external edit / peer form edit)

4. Apply mutations (if accepted)
   For each mutation: values[field] must still equal `from` else conflict
   Write `to`; update coordination channel state; set acceptedEventId / stamps

5. Optional inventoryConsumption (e.g. sauce-barrel) derived for atomic inventory apply under sync lock
```

## A.3 Producers

| Producer | Role |
|----------|------|
| `buildNetSecondServerClaims` | Sauce + app batch dues from canonical stored state |
| `buildWallClockServerTicks` | Case/tray/batch wall-clock events; replay capped at 6h |
| Client `useAutoTrack` / engine | Suggestions + local claim attempts when online path allows |

Server ticks prefer **stored** state so abandoned registers do not restart nets.

## A.4 Outcomes vs sync

- **duplicate:** idempotent retry (safe after timeout).  
- **stale:** wrong generation/sequence or lifecycle—caller must reschedule from server.  
- **conflict:** values moved under the claim—usually human/peer edit; do not force.  
- Accepted claims still sit inside day-state JSON → subject to **reconnect LWW** on the same fields if a stale complete PUT wins later (cross-cutting risk).

## A.5 State machine diagram

```text
                  ┌─────────────┐
                  │  scheduled  │ (nextDueAt)
                  └──────┬──────┘
                         │ claim built
                         ▼
                  ┌─────────────┐
         ┌────────│  submitted  │────────┐
         │        └──────┬──────┘        │
    duplicate            │            stale
         │           accepted            │
         │               │               │
         ▼               ▼               ▼
   no data change   mutations+coord    resync schedule
                         │
                    conflict?──► abort mutations
```

---

# B. Import apply transaction (practical model)

Import is **not** one SQL transaction across all domains. It is a **manager-driven apply pipeline** that writes authoritative master data, then relies on factory/profile sync.

## B.1 Phases

```text
1. Parse (lib: spec-import, premix, cheese, …) — deterministic preferred
2. Match (AI assist bounded: max brands/flavors/ingredients) — review UI
3. Preview (planned: structured diff) — not always mandatory today
4. Apply (authoritative writes):
     - brand profiles (explicit Apply can bypass softer merge paths)
     - recipes / mixes / packaging settings as importer defines
     - import history + change manifest
5. Replicate:
     - profileServerSync / factoryDataSync PUT or hydrate
     - SSE configurationInvalidation (profiles / factory-data / master-data)
6. Optional QC approval queue (separate plan; not blocking import phases)
```

## B.2 Authoritative vs soft writes

Brand profiles route distinguishes:

- **Authoritative** manager Apply (e.g. spec import commit) — intended to set server truth.  
- Softer client merges for ordinary edits.

Silent product-name drops during import are a known class of bugs (comments in brandProfiles routes); managers get lists of profiles needing re-import.

## B.3 Atomicity reality

| What | Atomic? |
|------|---------|
| Single profile row upsert | Yes (row-level) |
| Multi-entity import (profiles + recipes + mixes) | **Best-effort multi-step** — partial apply possible if failure mid-way |
| Undo/rollback | Planned via pre-apply snapshot + history; conflict if later import touched same entities |
| Day-state runs | Not rewritten by import; operators re-apply profile to runs |

## B.4 Risk register

1. Partial apply without rollback → inconsistent master data.  
2. AI match bounds exceeded → truncated suggestions (by design).  
3. Import apply concurrent with factory KV LWW → last stamp wins per key.  
4. Corpus harness is the safety net for parser regressions—not a substitute for preview.

---

# C. Factory KV — schema and route

## C.1 Schema (`factoryKvTable`)

Logical shape (from route usage):

```text
scope + key  →  value (JSON) + updatedAt
PRIMARY / UNIQUE (scope, key)
```

Scoped by sandbox/live (`currentScope()`), same family as day-state.

## C.2 API

| Method | Path | Capability |
|--------|------|------------|
| GET | `/factory-data` | `manage-factory-settings` |
| PUT | `/factory-data` | `manage-factory-settings` |

**GET:** all keys for scope → `{ data: { [key]: { value, updatedAt } } }`.

**PUT body:** `{ key, value, updatedAt? }`.

**Server LWW:**

```text
clientUpdatedAt = min(floor(clientStamp), now + 5 minutes)  // forward skew clamp
INSERT ... ON CONFLICT DO UPDATE
  SET value, updatedAt
  WHERE existing.updatedAt < new.updatedAt
```

Then re-read current row (winner may be older peer).  
`broadcastMasterDataChanged(..., "factory-data")` nudge on SSE (not full value broadcast).

## C.3 Client (`factoryDataSync.ts`)

| Key class | Behavior |
|-----------|----------|
| Cached | localStorage read cache; hydrate by stamp; write-through PUT |
| Server-only | stop reasons, packaging option lists—module state after fetch |

Fail-safe: errors swallowed; offline continues on cache.

## C.4 Comparison to day-state sync

| | Factory KV | Day-state |
|--|------------|-----------|
| Scope | Facility | Date + scope |
| Unit | One key | Whole JSON document |
| Concurrency | SQL `updatedAt` LWW + 5m clamp | protectRunValues + partial base |
| Revision | Per-key timestamp | `canonicalRevision` (intents); day PUT may not bump |
| Transport | REST PUT/GET | PUT + SSE full/partial |

**Takeaway:** Factory already has **server-bounded stamps** (5m). Day-state complete writes still lack an equivalent base fence—factory is the better template for causality hardening.

## C.5 Profile sync parallel

Profiles use dedicated tables/routes (`brandProfiles`) with authoritative import Apply, plus client `profileServerSync` hydrate/write-through analogous to factory KV. Invalidation family: `profiles`.

---

# D. Release-check graph

## D.1 Entry points

```bash
pnpm run release:check              # standard evidence dir
pnpm run release:check:full         # full browser + release-evidence-full
pnpm run release:check:typescript-7-promotion
# verify-only:
pnpm run release:check -- --verify-evidence
```

Success = process exit 0 **and** evidence verifier for **same git revision**.

## D.2 Stages (dependency barriers)

Observed stage names:

```text
prerequisites
source-library-preflight
shared-output
consumer-typechecks
release-tests
clean-start
container-smoke
browser-guard
browser-smoke
browser-calendar
browser-accessibility
browser-webkit
browser-full          # full mode only
```

Steps in the same stage share a barrier; explicit `dependsOn` lists gate later work.

## D.3 Gate inventory (standard labels)

**API shards (7):** unit → integration×3 → roles → sync → sync SSE  

**Prereq / quality:** security audit (high), shell inventory, generated API freshness, shared+artifact typechecks, recovery evidence, clean-start smoke, Render image smoke, onboarding bypass, operational evidence, model-bump  

**Package tests:** run-calculator, production-rules, inventory-math, spec-reconcile, **spec-import**, scheduled recipe, spec-export, **corpus**  

**Source library:** reconciliation verification + fixture tests  

**Browser (serial, stateful lock):** smoke, calendar, accessibility, WebKit smoke; full suite opt-in (~159 cases, 45m hard limit)

## D.4 Parallelism and isolation

- Shared lock: `/tmp/run-calculator-release-stateful-gates.lock` for DB/port isolation.  
- API stage: bounded child parallelism (default max 4; ≤2 DB-heavy shards).  
- Each API shard internal serial; time limits (~8m hard / 6m warn class).  
- Browser stages **strictly serial** (live-day safety).  
- Full browser: duration regression vs prior retained report (≥30s and ≥25% slower → alert, not auto-fail coverage).

## D.5 Evidence artifacts

| Path | Role |
|------|------|
| `release-evidence/` | Standard run |
| `release-evidence-full/` | Full mode |
| `browser-smoke/webkit-result.json` | WebKit gate |
| `browser-full/FINAL-REPORT.md` | Full suite GO report |
| `clean-start/*` | Startup health evidence |

Incomplete, stale-revision, or missing files ⇒ **not a pass**.  
Infrastructure timeout/error ≠ product FAIL narrative.

## D.6 Mental model DAG (simplified)

```text
[prerequisites: typecheck, audit, codegen freshness]
        │
        ├─► [source-library-preflight]
        │
        ├─► [release-tests: API shards + package tests + corpus]
        │
        ├─► [clean-start + container-smoke]
        │
        └─► [browser-* serial chain]
                 └─► [browser-full] (full mode)
                          │
                          ▼
                 evidence verifier (revision-bound)
```

---

# E. Cross-cutting recommendations

| Priority | Action |
|----------|--------|
| P0 | Keep claim `baseUpdatedAt` aligned with coordination stamps after multi-channel accepts |
| P0 | Treat factory KV’s **5m stamp clamp + SQL LWW** as the model for day-state complete-write hardening |
| P1 | Import: transactional batch or explicit multi-step progress + rollback snapshot |
| P1 | Release: critical-path subset for daily agents; full suite on release cadence |
| P2 | Document claim outcomes in Sync Status UI (duplicate/stale/conflict counts) |
| P2 | Profile authoritative apply: single “import transaction id” in audit log spanning entities |

---

# F. Test ideas (disposable)

1. **Claim:** sequence gap → stale; duplicate eventId → duplicate; external form edit mid-claim → conflict.  
2. **Factory KV:** two PUTs, older stamp loses; stamp +10m clamped.  
3. **Import:** kill process mid multi-entity apply → detect partial (manual or checksum).  
4. **Release:** `--verify-evidence` against wrong SHA must fail.

---

*End of remaining deep dives pack.*
