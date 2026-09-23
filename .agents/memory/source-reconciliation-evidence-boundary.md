---
name: Source reconciliation evidence boundary
description: Keep approved production source-library repair proof separate from mixed development fixtures.
---

Source-library release evidence must be verified against the database that owns
the approved repair. A development database containing E2E or temporary fixture
rows may legitimately have a marker-guarded partial result; that does not mean
the production repair is incomplete, and rerunning the same marker-guarded heal
is not a safe way to make the fixture resemble production.

**Why:** The repair is intentionally idempotent and only updates audited rows
whose IDs and names are present. A mixed development fixture can therefore
claim the repair while omitting most audited production targets. Treating that
partial fixture as release proof would either create unauthorized data or
misrepresent a NO-GO as a GO.

**How to apply:** Use the approved read-only production verification path for
production status, keep local release evidence bound to its matching database
and environment, and leave retained reports untouched when a development
source gate fails. Record the exact remaining NO-GO counts instead of resetting
markers, copying production data, or fabricating evidence.

Aggregate read-only counts from a managed production replica can classify the
target as matching, but they are not the bounded verifier result. Full release
evidence still requires the exact deployed Git SHA from the controlled
deployment/report handoff and a verifier run in the database-owning environment.

**Why:** Deployment metadata may confirm that a build is healthy without
exposing its source revision, while the local development `DATABASE_URL` can
point at a partial fixture. Accepting counts or the current checkout SHA would
mix database ownership and revision identity.

**How to apply:** Treat a matching production preflight without a bound
deployed revision as an actionable NO-GO. Do not generate a write-side
operational report merely to discover the revision; obtain the controlled
handoff, run the full read-only verifier, then import only its summary-shaped
output.

Production source-library evidence also requires an explicit approved database
owner attestation, compared with PostgreSQL's read-only catalog owner. Matching
counts alone are not evidence of database ownership, and owner names must not
enter retained summaries.

**Why:** An unrelated database can reproduce aggregate pool, alias, and marker
counts while still being the wrong production target.

**How to apply:** Configure the approved owner for release preflight and full
capture; classify missing or mismatched ownership as a fail-closed
`databaseOwner` check while retaining only bounded diagnostics.

The controlled deployment handoff may also carry a bounded `databaseOwner`
attestation. Release source-library checks use it when the environment does
not provide an owner and reject any mismatch between the two sources; the
owner remains outside retained evidence and checkpoint diagnostics.

**Why:** Keeping the owner attestation with deployment and revision identity
prevents preflight and production capture from silently targeting different
approved databases when release configuration drifts.

**How to apply:** Validate the handoff owner with the same PostgreSQL role
identifier bounds as the release configuration, resolve handoff-or-
environment ownership before database work, and report only the
`databaseOwner` check name and bounded count.