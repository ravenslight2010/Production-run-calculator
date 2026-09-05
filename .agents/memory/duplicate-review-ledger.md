---
name: Cross-device duplicate review ledger
description: Durable rules for manager-visible duplicate-review reminders across facility devices.
---

# Cross-device duplicate review ledger

Duplicate-review reminders are facility-scoped server records, not just a browser count. A scan may add a pending group, but it must never reopen a group already resolved or ignored. Only an explicit reviewed merge or ignore may close a group; reads and failed writes are advisory and must never apply a merge or delete master data.

**Why:** Managers work from multiple floor and office devices, while stale scans and offline sessions can arrive after another device has already completed the review.

**How to apply:** Keep the review ledger behind the existing inventory-management capability, refresh it on manager-device focus/poll, and preserve the last known local reminder when synchronization fails.