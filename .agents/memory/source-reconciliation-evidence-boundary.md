---
name: Source reconciliation evidence boundary
description: Keep approved production source-library repair proof separate from mixed development fixtures.
---

Source-library release evidence must be verified against the database that owns
the approved repair. A development database containing E2E or temporary fixture
rows may legitimately have a marker-guarded partial result; that does not mean
the production repair is incomplete, and rerunning the same marker-guarded heal
is not a safe way to make the fixture resemble production.

**Why:** The repair is intentionally idempotent and only updates audited rows
whose IDs and names are present. A mixed development fixture can therefore
claim the repair while omitting most audited production targets. Treating that
partial fixture as release proof would either create unauthorized data or
misrepresent a NO-GO as a GO.

**How to apply:** Use the approved read-only production verification path for
production status, keep local release evidence bound to its matching database
and environment, and leave retained reports untouched when a development
source gate fails. Record the exact remaining NO-GO counts instead of resetting
markers, copying production data, or fabricating evidence.