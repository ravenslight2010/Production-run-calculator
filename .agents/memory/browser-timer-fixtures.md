---
name: Browser timer lifecycle fixtures
description: Controlled browser verification for live timer pause, sleep, and resume behavior
---

Browser timer journeys must account for the production model's freezer/tunnel delay before expecting a case write, and should capture counters on the tab where they are rendered. Dough pipeline and machine-time surfaces are on the Dough tab, while case completion is on Run.

**Why:** A test can appear to prove a resume failure when it is actually checking before the configured tunnel has elapsed or querying a hidden tab surface.

**How to apply:** Use the existing Date/visibility simulation helpers, assert paused dough counters before advancing time, and advance past both the tunnel and one case period before checking the resumed case write.