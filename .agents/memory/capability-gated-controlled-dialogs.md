---
name: Capability-gated controlled dialogs
description: Safe lifecycle behavior when authorization disappears while a controlled modal is open.
---

When a controlled manager-only dialog loses authorization, make its effective open value false immediately and request that the state owner clear the stale open value exactly once. Do not abruptly remove an open portal from the tree.

**Why:** Focus-managed dialog portals have cleanup and focus-restoration work during close. Abruptly unmounting one during a capability transition can create repeated React updates, while retaining a true parent open value can reopen stale protected content if authorization later returns.

**How to apply:** Keep the dialog root mounted through the authorization transition, gate its effective open value with current access, and issue a guarded close callback only while access is absent and the controlled value is still true. Test both immediate content removal and non-reopening after access restoration.