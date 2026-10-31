---
name: Browser release case contract
description: Keep the browser release count synchronized with the cases included by the authoritative Chromium release config.
---

The full browser release evidence contract must match reviewed Chromium identities and projects, not just a discovery count. Coverage changes need an explicit owner decision before updating the contract; an increased discovery count is a review input, not permission to raise a budget.

Focused diagnostic journeys should use a separate isolated Playwright config rather than filtering the release config: the release reporter still enforces the full case count, and its web build expects an approved publish identity.

**Why:** Accidental discovery mixed dedicated TLS/container/opt-in/engine harnesses with intended app regressions. The owner chose a split that preserves existing coverage and puts additions in their appropriate lanes, not a blanket increase or deletion to reach the old count.

**How to apply:** Reconcile exact additions, renames, exclusions and duplicate/retired coverage against owner approval and the release guide. Preserve the three previously reviewed PWA release sentinels even when other PWA cases remain dedicated. Keep device and standalone authority lanes isolated. Require real-config discovery and runtime reporting to agree, but never treat collection as runtime or published evidence. Dedicated configs alone do not imply exclusion: ordinary default app regressions can also have focused viewport/engine lanes.