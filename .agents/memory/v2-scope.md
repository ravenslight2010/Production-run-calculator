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

The owner approved converting this V1-archived workspace to V2 and using the project's managed PostgreSQL database with all V2 objects confined to schema `v2`. This is logical schema isolation within a shared project database, not physical database isolation. The approved deployment target is one Reserved VM with separately supervised API and worker processes.

**Why:** The owner prefers to continue in this workspace to retain the V1 lessons and does not want a separate-project prototype that loses context. Replit provides managed development and production databases per project; an isolated schema allows V2 work here while preserving V1 schemas and data. Replit Publish migrates supported schema objects, but functions, triggers, and grants require a separately reviewed production step.

**How to apply:** Keep the server's `V2_DATABASE_URL` requirement strict. The Replit launcher may map the managed project `DATABASE_URL` only when `V2_USE_PROJECT_DATABASE=true`; never let V2 queries or migrations touch a V1 schema, and do not copy V1 rows or credentials without separate approval. Review all generated publish changes and ensure V2 functions, triggers, and grants are installed through the supported production database process before publishing. Use one Reserved VM, a process supervisor, bounded API/worker pools, the exact `.nvmrc` runtime, synthetic run evidence, and verified restart behavior. Do not claim a published or isolated physical database until those steps are actually complete.
