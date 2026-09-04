---
name: Cross-channel auto-track claims
description: Why shared timer channels need an authoritative accepted-write marker when rebasing queued deltas.
---

A run can have multiple automatic timer channels due together, and different channels may update the same counter in opposite directions. Serialize claims, but do not assume serialization alone makes their precomputed mutations current. Rebase a queued signed delta only when the intervening canonical stamp is explicitly identified as an accepted automatic event, including events accepted for a peer tab. Manual changes must invalidate the affected timer generation and remain non-rebasable.

**Why:** A single per-run value stamp advances for every channel. Without a server-authoritative accepted-write marker shared through canonical responses and peer broadcasts, one tab cannot distinguish a peer timer event from an operator correction; either legitimate due movement is lost or a manual correction is overwritten.

**How to apply:** Any future coordinated channel or counter must publish its accepted canonical stamp, preserve signed movement when queued behind another automatic event, and omit that marker when ordinary/manual writes invalidate coordination. Keep each channel's `nextDueAt` in one declared clock domain (wall milliseconds or pause-aware net seconds); manual invalidation must reset, not cross domains. For side effects tied to an accepted claim, use the stable event identity as the idempotency key rather than a corrected display count.
