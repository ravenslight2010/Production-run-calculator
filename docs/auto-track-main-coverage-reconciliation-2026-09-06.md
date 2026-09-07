# Auto-Track GitHub Main Coverage Reconciliation

## Comparison baseline

This audit is pinned to GitHub main commit
`6af26cacf235eba9bcbc403e774cdf7fd8fe920a` (`Step 7b: server
wall-clock bootstrap + client skip-latch`). Only its focused auto-track
assertions were reviewed. No source, retired AI surface, refactor-status file,
or CI/release configuration was restored.

The current workspace already includes the later shared wall-clock engine,
server-owned tick bookkeeping, foreground reconciliation barrier, canonical
claim adoption, and bounded post-End freezer drain. Those contracts supersede
the pinned commit's transitional client ownership model.

## Assertion classification

| Pinned-main assertion | Classification in current architecture | Evidence |
|---|---|---|
| Schedule conversion preserves `canonical`, `dueNow`, sequence, and due time | Still valuable; adapted | `autoTrackCoordinationClient.test.ts` verifies the schedule event forwards the complete shared schedule unchanged. Conversion into a synthetic coordination register is obsolete. |
| Derived schedule entries default their client sequence to zero | Obsolete | Derived schedules no longer manufacture coordination state. Only accepted claims advance the durable coordination register. |
| Every channel's `canonical` flag round-trips to the client | Already covered, with stronger semantics | Shared live-calc tests require matching lifecycle generation and private server ownership before a wall-clock entry is canonical, and reject stale-generation coordination. |
| Every channel's `dueNow` verdict round-trips to the client | Still valuable; adapted | The new client boundary test preserves the verdict unchanged; shared live-calc tests assert an overdue canonical entry is `dueNow: true`. |
| Fresh noncanonical wall-clock replay suppresses local case/tray/batch writes | Obsolete and intentionally not ported | Noncanonical now means local/offline fallback is allowed. Server suppression requires a fresh, canonical, explicit-not-due lease; accepted claims arbitrate races under the server row lock. |
| A canonical echoed entry never suppresses local wall-clock writes | Obsolete and inverted | A matching canonical server ownership record is authoritative. The server tick tests prove private ownership and client takeover boundaries instead of preserving the transitional echo rule. |
| A fresh server schedule suppresses duplicate net-channel claims | Already covered | Sauce hook coverage asserts only fresh canonical `dueNow: false` suppresses, while noncanonical and stale schedules fall back locally. |
| Due sauce/applicator channels emit one claim each | Already covered | Server tick tests assert one advancing claim per eligible due net channel; claim parsing/application tests assert one physical completion, sequencing, and idempotency. |
| Not-yet-due, invalid-rate, paused, ended, press-done, or skeletal rows do not claim | Already covered | Shared schedule, server tick, Sauce/applicator, and lifecycle tests cover the applicable gates. Post-End case drain is a newer, bounded exception and does not extend to net channels. |
| Wall-clock sleep/replay advances case/tray/batch bookkeeping without duplicate beats | Already covered more strongly | Shared wall-clock engine tests, server persisted-bookkeeping/restart/takeover tests, and screen-wake tests cover arm-before-due, due writes, long wall-clock jumps, bounded dough catch-up, and full case catch-up. |
| Once a browser/client register exists, the transitional server bootstrap stops that channel | Obsolete as written; replacement covered | The current server may take over an actually due client register, then continues only with matching private ownership. It does not steal a matching-generation client-owned channel before that boundary. |
| Browser wake preserves remote corrections and remote Stop before releasing auto-track | Already covered more strongly | Foreground wake guard and screen-wake tests cover adopt-before-publish, coalescing, failed-pull retry, lifecycle fencing, rebase, and one-normal-period continuation. |
| Competing claims cannot double-increment and retries are idempotent | Already covered | Coordination tests cover accepted/duplicate/stale/conflict outcomes, correction generations, run scoping, and unchanged non-owning registers. |

## Result

No production behavior was copied from the pinned branch. The only missing
boundary-level proof was that the current event publisher does not discard or
reinterpret schedule ownership metadata; that focused client test was added.
All other valuable assertions are already present at the shared engine, server
claim, wake-reconciliation, or hook boundary, while the skipped assertions
encode superseded client-owned behavior.