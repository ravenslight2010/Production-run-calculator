---
name: Isolated browser matrix diagnosis
description: How to interpret later-project timeouts in multi-project Playwright runs.
---

When a multi-project browser suite passes its first profile and times out on a later profile, rerun that profile in an independent isolated suite before classifying it as a browser/device defect or changing application logic.

**Why:** A browser regression check passed in desktop Chromium, timed out in phone Chromium only after that desktop project, and passed when phone Chromium ran alone. The timeout snapshot did not identify a failed assertion.

**How to apply:** Record matrix and standalone results separately. Use a single-project isolated run to establish behavior, and do not claim unrun projects are verified when the matrix does not finish.
