---
name: Browser release case contract
description: The Chromium source list includes physical-device-only cases that are outside the 159-case release evidence contract.
---

The full browser release evidence contract is 159 Chromium cases; the broader source discovery list also contains three physical-Android-only cases that are not part of that contract.

**Why:** Treating the unfiltered discovery count as the release count makes a complete run look incomplete and prevents the duration reporter from retaining revision-bound evidence.

**How to apply:** Encode the physical-device exclusion in the authoritative release command or config, then require the retained report to show expected, enumerated, and completed counts all equal to 159.