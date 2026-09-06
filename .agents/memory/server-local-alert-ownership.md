---
name: Server and local alert ownership
description: Durable rules for coordinating canonical server push with browser-local offline fallback.
---

Server push and local fallback must derive the same logical alert ID from the
same pause-aware timing generation. Crossing alerts must be armed before their
threshold, and one atomic device-side claim decides which transport may display.

**Why:** Read-then-write receipt checks race across a page and service worker,
wall-clock batch numbers diverge after pauses, and permanently-true historical
thresholds can resurrect stale alerts after dedupe retention expires.

**How to apply:** For any new production alert, define its canonical generation,
crossing/arming rule, deterministic due time, subscription eligibility, and
atomic IndexedDB claim before adding either server or local delivery.