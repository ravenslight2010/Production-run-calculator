---
name: V2 scope
description: Owner-confirmed baseline for planning the next version of the production app.
---

V2's first usable release should include run control, every production station, full inventory, importing, sync, and auto-tracking. It must support multiple devices working on one active run from the first release. When disconnected, the app is read-only until it reconnects. Launch web/PWA first; native mobile is not part of the initial scope. At cutover, carry setup and master data only; do not migrate historical production runs. Seed inventory with a fresh physical count.

**Why:** The owner chose to begin V2 planning after repeated V1 wake, sync, and auto-tracking failures, while keeping V1 available until V2 is ready.

Replit boundary for the initial API/worker design: artifacts within one project share data and publish together, without independent deployment modes. Separate projects have separate managed production databases. The compatible starting candidate is one Reserved VM deployment with supervised API and worker processes; test it in an isolated synthetic V2 project before feature work.

**Why:** The deployment and database boundaries documented by Replit rule out two independently deployed artifacts sharing one managed project database. A single deployment keeps the database boundary intact while separate processes can isolate event loops.

**How to apply:** Keep the live V1 deployment untouched during V2 development. Use these as confirmed product requirements, but get approval for the staged implementation plan before coding. Carry existing account identities and role assignments, require fresh sign-in, and never transfer sessions or reset tokens. Build full inventory workflows and establish V2 opening quantities from a new physical count, not V1 balances or history. Gate V2 feature work on an isolated Reserved VM pilot of both processes, shared synthetic DB, restart/publish behavior, and measured pool limits.
