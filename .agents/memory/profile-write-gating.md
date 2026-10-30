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

## Product supply-mode defaults

The owner confirmed that a pizza profile's Dough/Crust default belongs on the
server with the rest of the profile, not only on the device.

**Why:** It determines the product's normal supply mode; treating it as navigation
breaks consistent setup on another browser.

**How to apply:** Capability-gate changes like other profile edits, preserve recipe
fields and scoped cache ownership, and keep the mode of an existing run distinct
from a profile default. Do not replace shared-default regression checks with
device-local-only expectations.

**Linked-recipe bootstrap rule:** When a linked shared dough/crust recipe determines
the new run's mode, wait for canonical recipe data before applying the profile. If
the data is missing or stale and the fetch fails, leave the profile values and mode
unchanged and offer an explicit retry. Never interpret an unloaded list as an
unmarked recipe, and do not change an already-started run retroactively.

**Why:** Treating an unavailable recipe list as authoritative can silently start a
premade-crust profile in Dough mode. The owner chose wait-then-apply so incomplete
bootstrap cannot create a partial or incorrect setup.

**How to apply:** Resolve the current canonical marker before committing linked
profile values to a new run. Cover the pending, failed-fetch, explicit-retry and
already-started-run paths in browser tests.
