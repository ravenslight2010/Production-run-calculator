---
name: Browser navigation scroll timing
description: Page scroll resets during tab navigation must account for browser history restoration and content reflow.
---

When a tab transition is triggered by browser back or a menu, reset only the document
scrolling element and repeat the reset on the next animation frame.

**Why:** Browsers can restore the previous history offset or adjust the document after
the synchronous popstate handler, which can otherwise leave the new tab partially
scrolled.

**How to apply:** Keep nested overflow containers out of the reset target, skip
unchanged-tab transitions, and cover both direct tab changes and back navigation in
browser tests.