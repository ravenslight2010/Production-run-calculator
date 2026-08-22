---
name: Partial sync contract
description: Hot day-state writes may omit unchanged run values while recovery remains complete.
---

Partial sync writes are versioned and carry the server snapshot they were based on; omitted run values and cold sections are preserved by the server's locked per-run merge. A missing, malformed, stale, or raced dependency returns the complete authoritative snapshot without applying or broadcasting the delta. Complete snapshots remain mandatory for initial adoption and recovery.

**Why:** Recipe rows dominate large-day payloads, but treating a partial response as a full day snapshot risks erasing setup during wake, reset, or concurrent edits.

**How to apply:** Keep canonical server responses complete, validate partial metadata at the sync boundary, and preserve all existing LWW, epoch, blank-value, and date-scoping guards when adding new partial sections.