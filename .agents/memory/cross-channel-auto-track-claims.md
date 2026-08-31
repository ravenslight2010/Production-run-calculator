---
name: Cross-channel auto-track claims
description: Why shared timer channels need an authoritative accepted-write marker when rebasing queued deltas.
---

A run can have multiple automatic timer channels due together, and different channels may update the same counter in opposite directions. Serialize claims, but do not assume serialization alone makes their precomputed mutations current. Rebase a queued signed delta only when the intervening canonical stamp is explicitly identified as an accepted automatic event, including events accepted for a peer tab. Manual changes must invalidate the affected timer generation and remain non-rebasable.

**Why:** A single per-run value stamp advances for every channel. Without a server-authoritative accepted-write marker shared through canonical responses and peer broadcasts, one tab cannot distinguish a peer timer event from an operator correction; either legitimate due movement is lost or a manual correction is overwritten.

**How to apply:** Any future coordinated channel or counter must publish its accepted canonical stamp, preserve signed movement when queued behind another automatic event, and omit that marker when ordinary/manual writes invalidate coordination.

Shared deadlines cross device clock domains. Keep cadence as a remaining duration anchored to the accepting server timestamp, then translate that duration onto each receiving device's local clock. Never repeatedly adopt timing from a prior lifecycle generation; retained old-generation coordination can otherwise restart long timers on every periodic sync and starve them forever. Case deadlines are a special case: canonical Packaging-register adoption owns their rebase so a repeated coordination snapshot cannot erase legitimate running screen-off catch-up.

**Why:** Devices can differ by hours, and the server intentionally retains coordination state across lifecycle stamps. Raw absolute deadlines either let an ahead-clock peer run every render or make a behind-clock peer wait for hours; translating stale-generation deadlines on every sync creates permanent timer starvation.

**How to apply:** Normalize accepted deadlines at the server, communicate the acceptance timestamp, translate only the remaining duration locally, and adopt only matching-generation states with a strictly newer sequence. Rebase case timing when canonical Packaging progress actually changes. Stable peer listeners and canonical-response handlers must read the latest elapsed-case baseline from a ref, not a render closure, or a queued peer claim can turn one interval into a two-case jump.
