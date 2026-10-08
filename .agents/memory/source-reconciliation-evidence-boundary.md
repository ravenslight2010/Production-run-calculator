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
exposing its source revision. Replit provides deployment status and logs, but
not the source files or build artifacts of an already-live deployment. The
production SQL tool reads a replica, so its `current_user` must not be assumed
to attest the deployed app process's database role. Meanwhile, the local
development `DATABASE_URL` can point at a partial fixture. Accepting counts or
the current checkout SHA would mix database ownership and revision identity.

**How to apply:** Treat a matching production preflight without a bound
deployed revision as an actionable NO-GO. Do not generate a write-side
operational report merely to discover the revision; obtain the controlled
handoff, run the full read-only verifier, then import only its summary-shaped
output.

Production source-library evidence supports two explicit database-attestation
paths. The CLI capture requires an approved owner name and compares it with
PostgreSQL's catalog owner. The published-app endpoint instead attests that the
summary was captured through the currently published API's configured database
connection, bound to that app build; it is not an independent owner-name match.
Both paths retain bounded evidence only, never owner names or source rows.

**Why:** Replit Agent cannot access the published app's production connection
directly. The owner approved an app-provided, public, rate-limited summary so
the agent can capture without a manager running a command. This removes manual
owner-name entry but cannot independently detect a misconfigured production
database URL.

**How to apply:** Use the published-app path for unattended capture only after
confirming the official published URL and matching its reported revision to the
fresh deployment handoff. Describe its attestation as the app-configured
database, not an independently verified production owner. Use the CLI path when
independent owner-name confirmation is required; reject missing or mismatched
owner values there.

The owner publishes through Replit and expects the task or agent to retrieve
available evidence directly instead of asking them to relay fingerprints,
database-owner names, credentials, or files. When the public runtime path is
approved, the agent should check the live revision itself and use the capture
endpoint only after it matches the handoff.

**Why:** Repeated requests for information already available from the published
app turn task execution into manual relaying and block work on inputs the owner
does not have.

**How to apply:** Ask the owner only to perform the Replit publish when needed.
Then compare the live diagnostics revision to the handoff, capture through the
published app, and import only a revision-matched capture. Keep diagnostics
separate from the importable capture contract.

The controlled deployment handoff may also carry a bounded `databaseOwner`
attestation. CLI release source-library checks use it when the environment does
not provide an owner and reject any mismatch between the two sources; the
owner remains outside retained evidence and checkpoint diagnostics. The
published-app runtime-connection mode does not consume this field.

**Why:** Keeping the owner attestation with deployment and revision identity
prevents preflight and production capture from silently targeting different
approved databases when release configuration drifts.

**How to apply:** Validate the handoff owner with the same PostgreSQL role
identifier bounds as the release configuration, resolve handoff-or-
environment ownership before database work, and report only the
`databaseOwner` check name and bounded count.

Public pool mismatch diagnostics are separate from retained aggregate release
evidence. They may return at most ten stable pool IDs, approved source names,
mismatch types, and differing field names; never return current values or
recipe/ingredient rows. Keep the diagnostic response read-only, build-bound,
rate-limited, and outside the release evidence importer.

**Why:** A failed aggregate capture must remain rejected as release evidence,
but the agent still needs bounded information to investigate the mismatches.
Making diagnostics part of the capture contract would blur that boundary, while
returning raw recipe data would expose more production information than needed.

**How to apply:** Use a separate diagnostics endpoint for troubleshooting;
preserve the aggregate capture and importer contracts unchanged. Do not treat
diagnostic results as a passing reconciliation or as authorization to repair
production data.

Owner-approved pool exceptions must be separate, versioned, and hash-pinned to
the immutable source report, owner-review record, bounded mismatch diagnostic,
and live capture. Scope each exception to a stable recipe ID and the exact
differing field list. Keep raw mismatch totals visible alongside approved and
unresolved counts; only unresolved differences may be waived from the pool gate.
Never rewrite the approved report or alter production rows to make the gate pass.

**Why:** Owner-reviewed current values may intentionally differ from an older
approved baseline, while retaining recipe values in evidence is not acceptable.
A broad ignore switch or report rewrite would hide unrelated drift; a bounded,
reviewed descriptor set preserves the gate without exposing those values.

**How to apply:** Pin the exception manifest in the verifier, require exact
descriptor matches, and include its ID, digest, and classification counts in
summary evidence. Release validation and evidence import must require the same
digest. Missing rows, renames, unlisted IDs, and newly differing fields remain
unresolved and must fail the release gate.