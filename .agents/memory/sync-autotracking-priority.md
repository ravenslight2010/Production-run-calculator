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
