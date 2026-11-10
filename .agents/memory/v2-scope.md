---
name: V2 scope
description: Owner-confirmed baseline for planning the next version of the production app.
---

V2's first usable release should include run control, every production station, importing, sync, and auto-tracking. It must support multiple devices working on one active run from the first release. When disconnected, the app is read-only until it reconnects. Launch web/PWA first; native mobile is not part of the initial scope. At cutover, carry setup and master data only; do not migrate historical production runs. The server-side design still needs to be worked out.

**Why:** The owner chose to begin V2 planning after repeated V1 wake, sync, and auto-tracking failures, while keeping V1 available until V2 is ready.

**How to apply:** Keep the live V1 deployment untouched during V2 development. Use these as confirmed product requirements, but get approval for the staged implementation plan before coding. Carry existing account identities and role assignments, require fresh sign-in, and never transfer sessions or reset tokens. Establish an initial inventory count separately.
