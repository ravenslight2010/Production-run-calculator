---
name: Schedule move canonical writes
description: Safe ordering and payload semantics for moving scheduled runs into a live day
---

A schedule move is a read-modify-write operation over a canonical day snapshot. Its
destination write must be sent as a complete move payload rather than reusing a
partial-sync base snapshot marker from the read. A live sync can advance that marker
between the read and write, causing the server to return a partial fallback instead of
applying the append. A fallback response is not a successful destination write, and
the source must remain actionable until the destination is confirmed.

**Why:** Background live-sync writes can legitimately change the partial snapshot
identity during the move. Treating a fallback as success can leave the visible plan
unchanged while incorrectly deleting the only source copy.

**How to apply:** For future-to-live or future-to-future moves, build the payload
from the fetched canonical sections, omit partial-sync identity, require a written
canonical response, then trim/delete the source. Keep a same-session cleanup marker
only for retries after the destination is already canonical.