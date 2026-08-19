---
name: Profile writes are capability-gated (manage-profiles)
description: Brand/flavor profile saves & deletes are manager-only; the policy clients must follow.
---

Brand-profile writes are gated server-side on the `manage-profiles` capability.
Durable policy for clients:

- **Gate on the capability, never a role alias.** `isManager` derives from
  `manage-staff`; a custom role can hold `manage-profiles` without it. Gating
  on the alias blocks users the server would authorize (review-rejection
  lesson).
- **Indirect writers count too.** Rename/merge fan-outs, Move-to-Mixes
  relinks, packaging import patches, and one-time boot heals all rewrite
  profiles. A per-call-site audit misses some — the web app therefore has a
  central storage-level write gate flipped from capability resolution, so
  helpers called by capability-unaware components are covered.
- **Boot-time migrations can't see capabilities.** Profile-rewriting ones must
  be deferred into a capability-gated effect; marker guards make that safe.
- **A 403 on a queued profile write is terminal.** Drop the op unsynced; never
  retry, or a non-manager device retries forever and diverges from server
  truth. Non-403 failures still retry.
- Non-managers keep in-memory healing benefits; only persistence is skipped —
  a manager device performs the durable heal.
