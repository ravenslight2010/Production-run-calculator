---
name: Container image migration split
description: Historical Render migration behavior and transferable container lessons; not current production deployment guidance.
---

## Historical Render deployment context

This section records the former Render setup only. It is not current production
deployment guidance: `replit.md` is authoritative, and Replit is the only
authorized publisher of the active production app. Do not use Render
pre-deploy commands or manual Docker deployment steps to publish the app.

In that former setup, Render pre-deploy commands executed inside the same
prebuilt image that served traffic, so a separate full-builder migration image
could not be invoked by that command. The general container lesson remains:
any migration command run from a prebuilt image needs its required tooling and
payload available in that image.

**Why:** The API image was reduced to a bundled runtime, but Render's existing
single-service deployment still needed schema pushes before a fresh database
could serve requests. Nested Docker runners may reject every exec-based probe,
and PostgreSQL dump guards contain per-run random tokens even when the schema is
unchanged.

**How to apply:** For a non-production container rehearsal that uses this
former layout, verify migration behavior against disposable Postgres and keep
the long-lived API service pointed at the slim runtime target, never the full
migration target. For portable rehearsals, probe with one-shot sibling
containers rather than `docker exec` or container health commands, and
normalize only dump wrapper tokens before comparing schema fingerprints.
Follow `.agents/memory/replit-custom-migrations.md` and `replit.md` for current
managed production schema and publishing guidance.

Long-lived runtime images must not contain even an opt-in schema-push path.

**Why:** A runtime replacement can inherit an environment flag and apply an
older image's schema, silently turning an application rollback into a schema
rollback.

**How to apply:** In containerized tests or rehearsals, put schema mutation
only in a dedicated migration target or explicit migration phase, not in an
opt-in path inside the long-lived runtime. Rehearsals should fingerprint the
schema after migration, after the current runtime, and after the parent
runtime, retaining an actual schema diff when either runtime changes it. This
does not define the production migration path; follow the current publishing
and migration authority in `replit.md`.