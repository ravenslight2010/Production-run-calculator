# Source-Library Reconciliation Capture Endpoint

**Status:** Implementation plan
**Design:** `docs/superpowers/specs/2026-10-05-source-library-capture-endpoint-design.md`

## Goal

Implement the approved manager-only production capture endpoint without
changing the source-library report or its retained evidence semantics. Keep the
candidate toolchain at Node 24.21.0 and pnpm 12.8.1, preserve release-age and
security settings, and do not promote Node 26 or TypeScript 7.

The `writing-plans` skill named by the brainstorming workflow is not installed
in this workspace or skill registry. This plan is written directly from the
approved specification and current code.

## Implementation sequence

### 1. Extract an import-safe shared verifier core

- Refactor `scripts/src/verify-source-library-reconciliation.mts` so report
  parsing, report verification, bounded-output validation, and the shared
  `VerificationOutput` contract live in a module with no CLI argument parsing,
  file writes, process exit handling, or database connection creation.
- Keep the CLI as a thin entry point that reads its arguments and report file,
  creates its existing pool connection, and calls the shared core.
- Preserve the verifier’s exact output keys, evidence ID calculation, report
  digest, failure categories, CLI flags, and read-only transaction behavior.
- Keep existing exports available where current tests or scripts depend on
  them, by re-exporting from the CLI module if needed.

**Checks:** existing source-library verifier tests and release-evidence tests
must pass without changing retained report metadata or expected evidence
fixtures.

### 2. Package and verify the reviewed report bytes

- Have `artifacts/api-server/build.mjs` read the reviewed report at build time,
  verify SHA-256
  `1d8a2a3ddda96c32959e43fdcd901f3a14308bf12bc4d65ef4e2e3ce12505294`, and
  copy those exact bytes into the API `dist` directory.
- The production route reads only that packaged file. Do not make the API
  depend on `attached_assets` or include the full asset directory in the
  runtime image.
- Add a focused build check proving the packaged bytes match the reviewed
  digest. The existing Docker runtime copies the API `dist` directory, so
  confirm the report file is present in the resulting runtime artifact.

### 3. Add the capture service and endpoint

- Add a focused route module for `POST
  /profile-data/source-library-reconciliation/capture`.
- Require `requireLiveScope` and `requireCapability("manage-staff")` before
  database access; mark the response `Cache-Control: no-store`.
- Validate the serialized request bound (8 KiB), the supplied database-owner
  identifier, and the schema-version-2 deployment handoff. Reject a supplied
  owner that conflicts with an owner carried by the handoff.
- Compare the validated handoff’s `appBuildId` and
  `sourceFingerprintSha256` with the immutable identity from `getBuildInfo()`.
  Reject stale or non-current handoffs before opening a database connection.
- Permit only one capture at a time per server process. Reject a second
  overlapping capture with `409`.
- Acquire one client from the application database pool, begin
  `READ ONLY`, set `statement_timeout` to 15 seconds and `lock_timeout` to
  2 seconds, run the shared verifier’s sequential queries, then roll back.
  Destroy the client when a connection failure prevents a safe rollback.
- Return the verifier’s bounded output unchanged and enforce the 32 KiB
  serialized-response maximum. Return a completed verifier result with HTTP
  `200` even when its `ok` field is false. Use generic error bodies for
  database, verifier, and output-bound failures.

### 4. Register route authorization and API contract

- Mount the new router in the production route composition.
- Add the endpoint to the authorization inventory as manager-only, live-only,
  and denied in sandbox scope. Preserve the route-composition checks so the
  endpoint cannot silently disappear from the assembled API.
- Add OpenAPI request, bounded verification response, and error responses in
  `lib/api-spec/openapi.yaml`; regenerate the checked-in client/schema outputs
  using the repository’s documented code-generation command.
- Do not add a UI, database table, write route, report persistence, or repair
  behavior.

### 5. Add regression and safety tests

- Unit-test report packaging digest, request validation, expected database
  owner validation, handoff freshness/build matching, and exact output bounds.
- Test that authentication, capability, live-scope, malformed-input,
  expired-handoff, mismatched-build, and overlapping-capture failures occur
  before starting verifier queries.
- Test the valid path’s transaction order (`BEGIN TRANSACTION READ ONLY`,
  configured local timeouts, verifier `SELECT`s, `ROLLBACK`), no write queries,
  response `no-store` header, and exact bounded response.
- Test that `ok: false` is returned as a diagnostic `200`, and that connection,
  timeout, verifier, and oversized-output errors fail safely without exposing
  SQL, connection details, owner input, or raw database rows.
- Extend route authorization and composition tests for the new `POST` path.

### 6. Validate the candidate toolchain and release gates

- Run the focused API route/service and source-library verifier tests.
- Run API contract/code-generation checks and the workspace typecheck.
- Verify frozen installation and the configured candidate release checks under
  Node 24.21.0 and pnpm 12.8.1.
- Preserve `minimumReleaseAge` and all current security overrides. Do not edit
  historical manifest timestamps or otherwise make old evaluation evidence
  appear newly measured.
- Keep the already-run reviewer benchmark result faithful, including its
  failures. Do not spend additional Gemini budget without new authorization.

### 7. Complete production evidence through the owner’s Replit publish

- The Agent does not publish the application or authenticate as a production
  manager. After the owner publishes the completed source, a manager uses the
  current deployment handoff and approved database-owner name to invoke the
  endpoint.
- The manager retains the returned JSON and supplies it for the existing
  release-evidence importer. The importer and release checks must validate the
  deployed source identity, report digest, database-owner attestation, and
  capture time before considering the report fresh.
- Do not claim the production evidence or overall release gate is complete
  until that returned report is imported and the candidate release checks pass.

## Completion criteria

- Shared verifier behavior and CLI output remain compatible.
- The API image contains the exact reviewed report bytes and no broad source
  audit directory.
- The endpoint is reachable only to authenticated managers in live scope,
  never writes to production, and returns only the existing bounded summary.
- API contract, route tests, typecheck, and applicable candidate release gates
  pass under the exact pinned Node and pnpm versions.
- Fresh production reconciliation evidence is captured from the published
  revision and accepted by the existing importer before the release is called
  clear.
