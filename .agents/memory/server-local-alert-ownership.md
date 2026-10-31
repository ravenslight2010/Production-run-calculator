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

## Background lifecycle selection

Background timing alerts follow the canonical lifecycle, not a device's selected
screen. Their threshold arms, settings, calculations, and opaque identity must
all belong to that same lifecycle. A newer paused run suppresses timing alerts;
it must not cause a fallback to an older running run. Freezer drain alerts remain
intentionally independent and per-ended-run.

**Why:** Device selection is omitted from canonical sync, and draining one run
while producing another is valid. Sharing a default index or a global arm can
lose active-run alerts or attach an observation to the wrong generation.

**How to apply:** Exercise distinct settings on an ended first run and a later
active run without device selection. Verify pre-threshold arming, crossing,
replacement generations, opt-outs, and claim deduplication together.