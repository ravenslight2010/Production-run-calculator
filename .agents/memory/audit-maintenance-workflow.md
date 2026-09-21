---
name: Approved audit maintenance
description: The authorization and evidence boundary for exceptional audit-log redactions or deletions.
---

Exceptional audit changes must use the checked-in maintenance command through a separately authorized administrative connection that can assume the non-login maintenance role. The command records the authorizer, operator, reason, action, and target ID in the same transaction before calling the bounded database function; the normal application role must not be able to invoke that workflow.

**Why:** Audit history is compliance evidence. An operator needs a repeatable, reviewable approval trail, while the application must remain unable to rewrite or delete retained records.

**How to apply:** Keep maintenance inputs bounded and explicit, reject fallback to the application connection, make approval and the requested change atomic, and retain a compensating deletion event. Test both direct application-role denial and successful maintenance-role evidence.