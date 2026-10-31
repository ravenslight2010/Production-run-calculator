---
name: Replit staging project boundary
description: Keep reusable staging apps and databases isolated from a project's development and production resources.
---

Replit artifacts within one project share the project's backend, database, and settings. An independently deployed staging app needs a separate Replit project; its database and stage-only credentials must be established there rather than borrowing the source project's development or production resources.

**Why:** Replit's official Projects & Artifacts and Development/Production Database documentation defines the isolation boundary; separate publication cycles and access controls belong in separate projects.

**How to apply:** Before staging setup, confirm the separate project exists and independently identify its app/build and database. Do not treat another artifact or a local fixture as a reusable Replit staging deployment.

The owner also approved an isolated local testing sandbox for Replit's audits:
"If its in the sandbox, its ok. This is being done for that purpose, so this app can be tested by replit."
This permits a separately created disposable local app/database with synthetic
accounts; it does not authorize using the in-app shared-database sandbox,
production credentials, or publication.

**Why:** The owner's intent was to enable safe testing without repeatedly
requesting a separate project. Local sandbox evidence and independently
published staging evidence have different authority.

**How to apply:** Use a genuinely separate local PostgreSQL cluster and app
process when that satisfies the audit. Label it local, preserve the published
production verification limitation, and require new approval for publication.
