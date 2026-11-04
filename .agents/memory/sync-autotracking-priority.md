---
name: Sync and auto-tracking priority
description: User's reliability priority and consistency boundary for sync and station auto-tracking.
---

Sync is the app's second-most-important feature. The user wants Sauce, Dough, Frontline, and Packaging tracking to be reliable together; Sauce is the current highest-friction tracker. Align shared ownership, lifecycle, recovery, and convergence behavior, but preserve station-specific physical units, rates, capacities, and caps unless the user approves a behavior change.

**Why:** The user reported declining sync reliability and inconsistent tracker behavior, while each department represents different production work.

**How to apply:** Prioritize cross-system reliability audits and fixes. Do not equate consistency with one universal timer or formula; ask before changing production rules.

Canonical wake recovery may run independently of best-effort background refreshes; making every background operation share one serialized lane is not a safety requirement.

**Why:** The approved speed objective preserves canonical acknowledgement and conflict fences, but unrelated slow master-data reads must not determine operational recovery latency. Faster polling or weaker acknowledgement would hide the problem rather than solve it.

**How to apply:** Keep single ownership and write/adoption barriers for recovery itself. Treat ordinary refresh concurrency separately, and distinguish duplicate signals within one wake from a genuinely later sleep/offline boundary.

The user reports that a phone/PWA repeatedly attempts sync after waking, and a manual refresh only partly settles it. Screenshots showed queued changes and HTTP 200 acknowledgements alongside stale-base recovery that retained a server conflict; the recovery copy was unavailable. A later screenshot showed a network failure and two timeouts, including overlapping app requests while backgrounded. Those elapsed times are client-side waits, not server processing durations. This is symptom evidence, not an established cause.

**Why:** A successful request acknowledgement does not prove that the wake queue converged or that a retained conflict was safely resolved.

**How to apply:** Reproduce wake, reconnect, and refresh sequences; trace bounded queue/send/ack/recovery/conflict events; verify that the system settles without losing, duplicating, or silently overwriting operational changes.

Treat a pause as effective only after its canonical acknowledgement. A valid automatic claim can settle while the pause request is still in flight, so the state observed before the click is not a reliable post-pause baseline.

**Why:** Browser verification observed a legitimate auto-track update between the pause click and server acknowledgement; comparing against the earlier value falsely attributed it to a tick after pause.

**How to apply:** For live counters or stock, wait for the acknowledged paused state, take the baseline then, and verify subsequent ticks do not change it. Keep each station's production units and claim rules distinct.

When a queued stock claim is rebased, rebase its due anchor to the same canonical stock anchor and recompute the next due time from cadence; never retain the old schedule.

**Why:** The server validates exact anchor-to-due equality, so a stale due time can reject an otherwise valid recovery claim.

**How to apply:** Any stock-claim rebase path must update anchor, due time, and next due time together before sending the claim.

When a reset is adopted, invalidate any foreground recovery owner that started before it before the reset barrier can be released.

**Why:** An older recovery's cleanup can otherwise release the barrier and replay a stale queued write after the server has advanced the reset epoch.

**How to apply:** Advance the recovery-owner token as part of reset adoption and keep stale recovery callbacks from releasing or replaying work.

Every server-accepted automatic progress channel that peers merge independently must persist its private ownership proof atomically on every accepted producer path, including device claims and background ticks. Canonical state delivery alone is not sufficient when local stamps can tie or be newer.

**Why:** Cross-tab applicator stock stayed stale even though the accepted claim updated canonical state and SSE delivery had no errors; one producer path lacked the ownership proof required by the peer merge.

**How to apply:** When adding or changing auto-track producers or peer merge rules, verify the accepted sequence, generation, and timestamp proof survives both direct claims and server ticks, then test a second client adopting canonical progress.

After a successful canonical acknowledgement, suppress a queued snapshot only when its signature exactly matches the acknowledged state. Keep sending when a signature is missing or the queued snapshot differs.

**Why:** A wake sequence can leave an identical full-state snapshot queued after a successful response, producing duplicate writes; browser-observed request counts varied and did not identify the triggering caller.

**How to apply:** Compare queued work against the state actually acknowledged or rebased, not an obsolete pre-recovery body. Test canonical convergence and distinct write contents rather than relying on a fixed request count.

For an ordinary automatic-tracking conflict, adopt the canonical values and sequence, retire the rejected event identity, and continue with a fresh identity. A transport failure remains a same-ID retry for idempotency; lifecycle `stale` remains fenced for explicit recovery.

**Why:** The server durably records rejected event IDs, so replaying a conflict cannot accept newly computed values. A lifecycle-stale result is not equivalent to an ordinary value conflict.

**How to apply:** Rebase channel-specific state and cadence from canonical values; preserve same-ID retry for uncertain transport and never weaken the lifecycle-stale boundary.

When foreground recovery only rebases timers or resets wall-clock bookkeeping within the same run generation, preserve every accepted per-channel coordination sequence.

**Why:** A same-run wake reset can clear the client sequence after an accepted claim while the server still expects its next value; the next claim then reuses the old sequence and is rejected as stale.

**How to apply:** Keep sequence lifetime tied to run/generation, not timer-baseline lifetime. Reset it only on a new run/generation; test wake recovery followed by a second accepted claim using the next sequence.

Manual App1–App4 stock buttons are signed step adjustments, not absolute replacements. Rebase them only across contiguous ledger history that proves every same-section change was an accepted auto-track claim for the same run; preserve consumption and batch counters, and reject manual or unknown intervening writes.

**Why:** The owner approved automatic rebasing of manual +/- stock steps over verified auto-track claims, but not overwriting unrelated or ambiguous edits.

**How to apply:** Keep this narrow to explicit stock-step actions. Test multiple accepted claims through the real endpoint, exact delta application, idempotent retry, preserved counters, and fail-closed stale manual writes.

Synthetic auto-track ticks in browser tests must not move canonical anchors ahead of real server time before a manual operation.

**Why:** A test that injected a tick at run-start plus 60 seconds while the server clock was only about 10 seconds past start correctly hit the server's future-anchor guard; it was a fixture time-travel error, not evidence for weakening production validation.

**How to apply:** Align the fixture's start time and injected tick to the same clock before testing a following manual edit or pause.
