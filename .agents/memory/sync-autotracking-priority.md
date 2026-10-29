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
