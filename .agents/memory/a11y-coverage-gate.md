---
name: Accessibility coverage gate
description: Keep accessibility smoke checks isolated from destructive live-day setup and separate stable UI rules from known shell debt.
---

The accessibility gate should use isolated accounts, explicit desktop/phone/tablet viewports, and a public sign-in contrast check. Authenticated axe scans may scope out documented legacy shell findings, but focused checks must still cover labels, focus visibility, dialog naming, zoom, and touch-target geometry.

**Why:** The operational shell contains older contrast, landmark, and decorative-control findings that can obscure regressions in the workflows being exercised; destructive global setup also makes accessibility checks unsafe to run casually.

**How to apply:** Keep the gate independent from the main Playwright config, add viewport-specific checks there, and treat publish-banner or foreground-sync interference as setup limitations rather than product accessibility evidence.