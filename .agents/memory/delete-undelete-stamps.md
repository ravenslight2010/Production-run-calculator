---
name: Delete/un-delete stamp LWW
description: Why deletedItems tombstones need per-name stamps so a deliberate re-add survives the sync union
---

**Rule:** `deletedItems` tombstones sync via pure union, so removing a tombstone locally (`clearDeleted`) can never win on its own — the next sync pull resurrects it and `dropDeleted` strips the re-added name from every picker. Any deliberate re-add of a once-deleted name (spec import re-registering a flavor, manual re-add) must be arbitrated by the synced per-name stamp maps `deletedStamps` / `undeletedStamps` (namespace → lowercased name → epoch ms, merged per-name by MAX on push AND receive). Effective delete = name in `deletedItems` AND deleteTs (legacy unstamped = 0) >= undeleteTs.

**Why:** Prod incident: a spec import wrote 8 brand profiles to the server pool and registered the flavors, but the user had previously deleted those flavor names; the synced tombstones came back on the next pull and hid the flavors everywhere while the profiles sat orphaned — "my import doesn't show up anywhere."

**How to apply:**
- `clearDeleted` must ALWAYS stamp the un-delete, even when this device holds no local tombstone (the tombstone may live only on server/peers).
- `tombstoneDeleted` stamps on every call so a re-delete after an un-delete moves the stamp forward and wins again.
- All consumers must go through `dropDeleted` (it applies the stamp compare internally) or replicate the compare — watch direct `deletedMap["ns"]` set builds in the receive path.
- Server treats these payload fields as opaque; no server change needed.
- `mergedAway` (merge tombstones) still lacks this mechanism — same resurrection risk applies if a merged-away name ever needs a deliberate re-add.
