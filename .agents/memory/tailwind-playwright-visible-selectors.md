---
name: Tailwind source scanning and Playwright selectors
description: Avoid production CSS warnings caused by Playwright-only selector syntax in files scanned by Tailwind.
---

Tailwind source detection can treat complete Playwright locator strings as class candidates. Playwright's nonstandard `:visible` pseudo-class can then produce malformed attribute selectors in generated production CSS.

**Why:** The UI classes can be valid while production builds still emit `Unexpected "="` warnings for selectors derived entirely from end-to-end test locator strings. A CSS minifier may discard those generated rules.

**How to apply:** In source trees scanned by Tailwind, prefer ordinary CSS selectors followed by Playwright's locator visibility filter instead of embedding `:visible` after attribute selectors. Confirm with a production build and scan the emitted CSS for malformed selectors.