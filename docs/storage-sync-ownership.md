# Storage and synchronization ownership

This document is the contract for the run calculator's offline and
multi-device state. It describes ownership, not a second protocol.

## Responsibility map

| Responsibility | Owner | Must not own |
|---|---|---|
| JSON records, decode validation, bounded migration, corruption fallback, unavailable/quota handling | `adapters/browserRecordStore.ts` and domain-specific browser adapters | merge winners, HTTP, React state |
| Canonical live `DayState` and selected run/form | `Home` | a second persisted state tree |
| Connection baseline, push coalescing, acknowledgement, wake barrier, reset and generation ordering | `synchronizationStateMachine.ts`, composed by Home | domain normalization or persistence formats |
| Run lifecycle/value adoption, blank protection, tombstones and stamps | pure domain policies under `domain/` | browser APIs, React, HTTP |
| Wire document identity, partial dependency validation and response envelopes | server `lib/syncContract.ts` | business merge decisions |
| Server conflict resolution and protected-value merge | `protectRunValues.ts` within the locked daily-sync transaction | route response formatting |
| Run templates | `runTemplatesRepository.ts` using the browser record adapter | live-day ownership |
| Immutable completed history | `completedHistorySync.ts` using a scoped cache and per-operation durable outbox | resettable live-day ownership |
| Operational pause/resume/end/correction commands | browser operational-intent outbox plus server intent ledger | snapshot retry identity |
| Alerts | alert producer/consumer modules; delivery work uses the same stable-ID acknowledgement convention | live-day snapshot ownership |

`storage.ts` is a compatibility facade while callers migrate. New direct
`localStorage` access is not allowed there or in repositories: add a typed
record/adapter method instead. Existing domain helpers may be moved without
changing behavior, but persistence must not import domain conflict policy.

## State-machine transitions

1. **Connecting:** local reads are allowed; publish requests are retained.
2. **Ready:** the client has consumed its initial canonical snapshot.
3. **Pushing:** exactly one PUT/retry chain is active; newer local snapshots
   replace the queued snapshot.
4. **Waking:** pull and adopt canonical state before releasing queued writes,
   lifecycle commands, or auto-track. A failed pull remains in this phase.
5. **Resetting:** advance the reset generation, cancel older work, honor the
   epoch locally, then reconnect from an empty baseline.

Only a matching generation may acknowledge wake/reset work. A successful HTTP
status is not an acknowledgement until its response is classified: stale
responses honor the server epoch, canonical responses are adopted, unchanged
responses acknowledge the matching snapshot, and terminal failures retain only
the durable per-operation queues that define retry behavior.

## Canonical data ownership

The browser has one live `DayState` owner: Home and its latest-value ref. The
browser cache is a restart aid, not another authority. The server has one wire
contract (`syncContract.ts`) and one canonical row per scope/date. All ordinary
writes pass through the protected merge while holding the reset fence and daily
row lock.

Templates, completed history, sleeping-browser recovery, and operational
commands use the same conventions:

- scope every durable queue;
- assign a stable operation identity;
- preserve pending work until canonical acknowledgement;
- verify scope and generation before applying an async response;
- adopt canonical state before deleting acknowledged work;
- never replay a source import or other non-idempotent action as a snapshot.

## Preserved invariants

- client-local date is threaded through every sync endpoint;
- reset epochs fail closed after the first reset;
- reset, ordinary writes and operational intents use compatible lock ordering;
- tombstones and delete/undelete stamps survive stale clients;
- run metadata and run values keep separate LWW stamps;
- blank-over-populated values are rejected on client and server;
- wake reconciliation adopts before publishing or advancing counters;
- completed history and pending completion uploads survive live-data reset;
- reset does not introduce another state store or protocol.

## Offline recovery failure matrix

Operational intent recovery is deliberately durable at every acknowledgement
boundary. The following outcomes are deterministic and reviewable:

| Failure point | Local result | Recovery |
|---|---|---|
| Browser closes while pending | Per-ID pending record remains | Reload and retry after connectivity returns |
| Browser closes while sending | Sending record remains replayable | Reload re-delivers the same intent ID; the server ledger is idempotent |
| Network/server/rate-limit failure | Pending record retains bounded attempts, failure, and next retry time | Automatic backoff or explicit Retry |
| 401/token expiry | Blocked terminal receipt with auth guidance; no automatic replay | Complete normal sign-in, then Retry |
| Reset while pending | Older-epoch intent is blocked before delivery and retained for review | Retry explicitly, which adopts the current epoch, or Discard |
| 400/422 validation failure | Permanently rejected receipt with correction guidance | Review the run and create a corrected action; discard the receipt if appropriate |
| 403 permission failure | Blocked receipt with manager/permission guidance | Resolve access, then Retry |
| Local corruption or quota failure | Health signal is visible in Sync Status; valid records are not deleted | Free space or reload, then review/retry retained records |
| Accepted response before terminal write | Sending record is retained until terminal receipt can be persisted | Reload/reconnect retries the idempotent intent |

Recovery telemetry is aggregate-only and bounded: it reports counts of
unresolved, pending, sending, repeatedly failing, corrupt, and storage-failure
records. It does not include action payloads, identities, or recipe data.