---
name: Profile display identity across retries
description: Keep canonical profile matching keys separate from user-facing brand and flavor spelling.
---

Canonical profile identity may be case-folded for matching, but a save must preserve the server's or user's display spelling. Never derive display values from normalized keys.

**Why:** A queued profile update changed a saved brand's display spelling from "Acme" to "acme" even though it targeted the same canonical profile.

**How to apply:** Pass explicit display identity through save and queue operations; preserve known server spelling across coalesced/offline retries while retaining generation and scope fences.
