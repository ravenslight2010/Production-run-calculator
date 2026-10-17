# Manager-Only Source-Library Reconciliation Capture Endpoint

**Status:** Approved for implementation
**Date:** 2026-10-05

## Context

The release gate requires a fresh source-library reconciliation report bound to
the currently published source identity and the database that owns the approved
repair. The existing verifier already produces the required bounded evidence
from one PostgreSQL `READ ONLY` transaction. It currently runs as a standalone
script in the environment that owns production `DATABASE_URL`.

The Replit-published API image contains the bundled server, not the standalone
script files or the source audit directory. A production replica SQL query can
provide useful counts, but it does not replace the exact verifier result. The
current deployment handoff also does not carry an approved database owner.

## Goals

- Let an authenticated production manager request the same bounded report that
  the release verifier produces.
- Bind each capture to a fresh, independently produced handoff that matches the
  live API build, and to an explicitly supplied approved database owner.
- Keep the production database read-only during capture and return no recipe,
  profile, run, or other raw-row payloads.
- Preserve the standalone verifier and its existing evidence/import contract.

## Non-goals

- Publishing or deploying the application.
- Writing or retaining a report in the production database, filesystem, or logs.
- Adding a new secret, database setting, schema, scheduled job, or automatic
  startup capture.
- Adding a manager-facing UI. A manager invokes the API using an authenticated
  session and retains the returned JSON for the existing evidence-import step.
- Changing source-library repair data or its marker.

## Approaches considered

1. **Manager-only capture endpoint (selected).** Reuse the verifier from the
   deployed API, which already owns the production database connection. This
   avoids unsupported production shell access and preserves the verifier’s
   exact evidence semantics. It requires making the verifier core import-safe
   and bundling the reviewed report bytes.
2. **Keep the standalone CLI.** This is the smallest code change, but still
   requires shell access to the environment owning production `DATABASE_URL`.
   The published Replit runtime does not expose that shell to the Agent.
3. **Capture automatically at startup.** This removes a manual request but
   repeats on restarts and creates pressure to persist or log evidence. It also
   makes routine app startup responsible for a release-only operation.

The endpoint is preferred because it fits Replit-only publishing while keeping
the data check explicit, manager initiated, and read-only.

## API and authorization

Add `POST /profile-data/source-library-reconciliation/capture`.

The JSON request contains:

- `deploymentHandoff`: a fresh schema-version-2
  `published-source-deployment-handoff` from the existing published-build
  verifier.
- `expectedDatabaseOwner`: the approved PostgreSQL owner name. This is an
  operator-supplied identifier, not a credential; validate its length and
  characters, compare it with PostgreSQL’s catalog result, and never echo or
  retain it.

Require an authenticated user with `manage-staff` capability and reject
sandbox scope before doing any database work. The route is live-only and sends
`Cache-Control: no-store`. Reject a serialized request body over 8 KiB before
opening a database transaction. No pagination is needed because the response
is the verifier’s fixed-size summary.

Before opening the database transaction, validate the handoff’s schema,
expiry, independent expected-source binding, and source identity. Require its
app build ID and source fingerprint to equal the immutable values returned by
the running API’s `getBuildInfo()`. Reject stale, malformed, or non-current
handoffs without querying production.

## Capture and data flow

1. The API validates the manager, live scope, request size, handoff, current
   build identity, and expected database owner.
2. The build includes the exact reviewed source-library report bytes. The build
   step verifies their SHA-256 against the reviewed report digest; the endpoint
   does not read a path that is absent from the slim production image.
3. A side-effect-free verifier module contains the reusable parse, query,
   comparison, and bounded-output functions. The existing CLI calls this same
   module, so there is one source of truth. CLI argument parsing and process
   startup remain outside the module.
4. The route obtains one client from the application’s database pool, begins a
   PostgreSQL `READ ONLY` transaction, sets transaction-local
   `statement_timeout` to 15 seconds and `lock_timeout` to 2 seconds, performs
   the verifier’s sequential `SELECT` queries, validates the exact evidence
   allowlist, and rolls back the transaction before releasing the client. On a
   timeout or connection failure, it rolls back or destroys the client before
   returning. No writes, repair calls, or persistent evidence records are
   permitted.
5. Allow at most one capture at a time per server process. Return the
   verifier’s existing bounded `VerificationOutput` unchanged, rejecting a
   serialized response over 32 KiB. It contains only approved metadata, hashes,
   bounded counts, and failure categories—not raw source rows or recipe
   contents.

The endpoint does not save evidence. The manager retains the JSON response and
uses the existing local importer and release-check commands. The endpoint stays
in the application after capture so the evidence remains bound to the code
that was published.

## Error behavior

- `401` or `403`: missing authentication, capability, or live scope.
- `400`: malformed request, invalid owner identifier, or invalid handoff shape.
- `409`: expired handoff, valid handoff that does not match the live build, or
  another capture is already in progress for this server process.
- `503`: database connection or statement timeout, or unavailable running
  build identity; return a generic message without connection details or SQL
  payloads.
- `500`: verifier or evidence-bound invariant failure; return a generic message
  without database details.
- `200`: a completed verifier report, including `ok: false` and bounded
  failure categories when the database checks do not pass. Such a report is
  diagnostic and must not be treated as passing release evidence.

Do not log the request body, owner name, report contents, or database rows.

## API contract and tests

- Add the request and response contract to `lib/api-spec/openapi.yaml` and
  regenerate the API schemas and client artifacts.
- Test rejection of unauthenticated, non-manager, sandbox, malformed, expired,
  and non-current-build requests before production queries are run.
- Test that a valid request uses a read-only transaction with the configured
  timeouts, performs no writes, returns the exact bounded evidence shape, and
  rejects an output exceeding the evidence bound.
- Test that the bundled report bytes match the reviewed SHA and that the CLI
  and API use the same verifier functions.
- Run the focused API tests, API contract checks, full typecheck, and the
  applicable release checks. Production capture is performed only after the
  owner publishes the new build through Replit.

## Operational boundary

The Agent will not publish or authenticate as a production manager. After the
owner publishes, a manager must invoke the endpoint with the newly generated
handoff and approved database-owner name, then retain or provide the returned
JSON for the existing importer. No report is considered fresh until its
revision, report digest, and capture time pass the release importer’s checks.
