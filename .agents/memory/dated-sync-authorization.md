---
name: Dated sync authorization
description: Authorization boundary between current-shift collaboration and protected schedule writes.
---

Ordinary signed-in staff may collaborate on the current shift only through the
explicit current-day sync surface. Generic date-addressed writes are scheduling
operations and require the factory-settings capability, even when the requested
date happens to equal a client-provided “today” value.

**Why:** A query parameter or payload date is controlled by the caller. Using it
to decide whether a capability is required lets a regular user label any future
date as “today” and bypass schedule authorization.

**How to apply:** Keep current-day floor clients on the explicit today route.
Treat every generic dated write as protected before its handler runs, and include
an adversarial test where the caller sets its claimed today equal to a future
target date.