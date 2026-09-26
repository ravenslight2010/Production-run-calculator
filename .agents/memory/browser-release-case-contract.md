---
name: Browser release case contract
description: Keep the browser release count synchronized with the cases included by the authoritative Chromium release config.
---

The full browser release evidence contract must exactly match the Chromium cases selected by the authoritative release config. Device-tagged checks need an explicit per-case decision: dedicated physical-device journeys stay in their device lane, while a retained skipped sentinel may remain in the Chromium contract.

**Why:** Treating the unfiltered discovery count as the release count makes a complete run look incomplete and prevents the duration reporter from retaining revision-bound evidence.

**How to apply:** Encode device-case exclusions in the authoritative release config, then require Playwright discovery, the duration reporter, release checker, and retained report to agree. Update the declared count whenever included coverage changes.