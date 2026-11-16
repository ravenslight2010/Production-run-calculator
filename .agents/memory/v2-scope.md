---
name: V2 scope
description: Owner-confirmed baseline for planning the next version of the production app.
---

V2 is intended as an upgraded successor to the current production app, not a simpler replacement. Preserve the user-facing capabilities of V1 unless the owner explicitly agrees to retire one; rebuild the implementation where needed for reliability, shared multi-device operation, and a better floor workflow. Build and verify in small stages, but do not confuse staged delivery with reducing the agreed release scope.

V2's first usable release should include run control, every production station, full inventory, importing, sync, and auto-tracking. It must support multiple devices working on one active run from the first release. When disconnected, the app is read-only until it reconnects. Launch web/PWA first; native mobile is not part of the initial scope. At cutover, carry setup and master data only; do not migrate historical production runs. Seed inventory with a fresh physical count.

The product has one production facility. It may have multiple warehouses for inventory; warehouses are inventory locations, not separate production facilities. Do not build facility switching or multi-facility workflows unless the owner later requests them. A single internal facility identity may still be used as a data-ownership or authorization boundary.

## Setup import format

The owner approved V2 CSV templates as the first format for product, recipe, production-setup, and physical opening-count imports. Do not assume legacy workbook support.

**Why:** The owner explicitly selected CSV templates rather than starting with existing spreadsheet workbooks.

**How to apply:** Keep the V2 headers and validation explicit and reviewable. Add Excel/workbook parsing only after a separate approval.

## Sign-in model

V2 should rebuild the current username/password sign-in using V2-owned accounts and sessions. Staff must sign in fresh; do not reuse V1 sessions or reset tokens. The method for provisioning V2 accounts and the transfer of any password hashes remain separate cutover decisions.

**Why:** The owner selected rebuilding the existing username/password model for V2. This does not authorize transferring credentials, tokens, or sessions from V1.

**How to apply:** Implement username/password verification and session lifecycle only against the V2 database. Do not add public self-registration or assume that V1 password hashes will transfer; use a separately approved bootstrap/provisioning process and require fresh V2 sessions at cutover.

**Why:** The owner wants an upgraded version of the existing app; a leaner interface or simpler feature set would be a downgrade. Small slices are for reducing implementation risk and validating behavior, not for deleting existing capability. V2 planning began after repeated V1 wake, sync, and auto-tracking failures, while keeping V1 available until V2 is ready.

Replit boundary for the initial API/worker design: artifacts within one project share data and publish together, without independent deployment modes. Separate projects have separate managed production databases. The compatible starting candidate is one Reserved VM deployment with supervised API and worker processes.

**Why:** The deployment and database boundaries documented by Replit rule out two independently deployed artifacts sharing one managed project database. A single deployment keeps the database boundary intact while separate processes can isolate event loops. The owner later clarified that isolated source development may begin in `v2/` within the current workspace; the separate-project pilot is a pre-release gate, not a prerequisite to writing V2 code.

**How to apply:** First create a feature-parity inventory from the current app and identify which V2 areas are implemented, missing, or deliberately improved. Keep all existing V1 capabilities in the V2 target unless the owner explicitly retires them. Stage vertical slices to test the new server and client design without turning staging into a launch-scope cut. Model one production facility and represent its separate stock locations as warehouses within inventory. V1 is no longer live; preserve its source baseline and data while authoring V2 under `v2/`, and do not move shared V1 code until dependency ownership is mapped. Keep V2 on its own database and never reuse V1 sessions or reset tokens. Carry setup/master data and staff identities/roles at cutover, requiring fresh sign-in; resolve password-hash transfer separately before cutover. Build full inventory workflows and establish V2 opening quantities from a new physical count, not V1 balances or history. Before publishing V2, validate an isolated Reserved VM project with both processes, a synthetic database, restart/publish behavior, and measured pool limits.
