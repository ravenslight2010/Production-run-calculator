---
name: Cross-channel auto-track claims
description: Why shared timer channels need an authoritative accepted-write marker when rebasing queued deltas.
---

A run can have multiple automatic timer channels due together, and different channels may update the same counter in opposite directions. Serialize claims, but do not assume serialization alone makes their precomputed mutations current. Rebase a queued signed delta only when the intervening canonical stamp is explicitly identified as an accepted automatic event, including events accepted for a peer tab. Manual changes must invalidate the affected timer generation and remain non-rebasable.

**Why:** A single per-run value stamp advances for every channel. Without a server-authoritative accepted-write marker shared through canonical responses and peer broadcasts, one tab cannot distinguish a peer timer event from an operator correction; either legitimate due movement is lost or a manual correction is overwritten.

**How to apply:** Any future coordinated channel or counter must publish its accepted canonical stamp, preserve signed movement when queued behind another automatic event, and omit that marker when ordinary/manual writes invalidate coordination. Keep each channel's `nextDueAt` in one declared clock domain (wall milliseconds or pause-aware net seconds); manual invalidation must reset, not cross domains. For side effects tied to an accepted claim, use the stable event identity as the idempotency key rather than a corrected display count.

Server ownership must be proven by private, server-written state that matches the
public coordination generation and sequence. A matching public register alone
may have been written by a client and must remain non-authoritative until the
server accepts the next due claim. Client controls that affect server-owned
channels, such as an independent dough-timer pause, need a separately validated
and generation-bound sync register; pausing must freeze due arms and anchors,
while resume rearms once without replaying paused time.

**Why:** Treating any canonical-looking coordination record as server ownership
can suppress clients while the server refuses to advance a client-owned
sequence, leaving no owner. Keeping pause controls only in browser refs lets the
server continue mutating counters after the operator paused them.

**How to apply:** Persist server ownership only after an accepted locked claim,
make schedule leases authoritative only while private ownership still matches,
and let a due server tick take over a client sequence before suppressing local
writes. Sanitize client-control registers at the sync boundary, merge them by
newest update per run, discard them on reset, and propagate inbound controls to
peer clients without echoing them back.

Capture run identity when dispatching asynchronous claims. After a run switch,
every completion path—including retry/error cleanup—must ignore the old claim;
otherwise a late response can write into the shared form or clear the new run's
same-channel pending marker. Pending runs may keep staged Dough, but Packaging,
Sauce, and Frontline completion stay zero until Start and then rebase from that
run's own anchors.

**Why:** The form and channel-pending registry are shared across selected runs,
so guarding only the successful value write does not protect retry and cleanup
paths from cross-run contamination.
