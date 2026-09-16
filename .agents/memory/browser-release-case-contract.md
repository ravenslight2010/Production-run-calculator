---
name: Browser release case contract
description: The Chromium source list includes physical-device-only cases that are outside the 159-case release evidence contract.
---

The full browser release evidence contract is 159 Chromium cases. Device-tagged checks need an explicit per-case decision: dedicated physical-device journeys stay in their device lane, while a retained skipped sentinel may remain in the Chromium contract.

**Why:** Treating the unfiltered discovery count as the release count makes a complete run look incomplete and prevents the duration reporter from retaining revision-bound evidence.

**How to apply:** Encode the device-case exclusion in the authoritative release config, then require Playwright discovery, the duration reporter, and retained report to agree on 159. Review the exclusion whenever device coverage changes.