# Automatic build-version reporting

## Approved goal

Record the source version during building and let release tests retrieve it from
the published app, without asking the owner for GitHub numbers or repeated
Publishing screenshots. GitHub remains a backup, not the publishing source.

This design applies to future builds. It cannot reconstruct the source version
of an older published build. Implementation does not authorize publishing,
production repairs, or a production GO decision.

## Approach

Use an immutable application-owned build record plus a read-only lookup and
verification command. Prefer this to runtime Git lookups or logging a version
for someone to copy manually.

An application build ID is explicitly **not** Replit's internal Build UUID.
Optional platform identifiers are reported only when actually available; never
derive them from a URL, short history label, screenshot date, or Git branch tip.

## 1. Source preparation and build stamping

Add a small Node-based source-identity module and preparation command, using
existing pinned tools and Node's standard library.

The preparation command captures:

- A versioned SHA-256 fingerprint of the application's build inputs.
- A new namespaced application build ID.
- A full local Git revision only when those inputs can be verified against that
  revision. Otherwise the Git field is explicitly unavailable.
- A UTC preparation time and the fingerprint-policy version.

The source fingerprint covers backend and frontend source/configuration/assets,
workspace library sources and migrations, package manifests, the lockfile,
workspace configuration, and the scripts/configuration that build the app.
It includes untracked application input files rather than trusting only
`git ls-files`. It excludes secrets, local caches, dependency installations,
test/fixture/evidence data, generated identity records, and build outputs.
The inclusion/exclusion policy is explicit and versioned. Runtime libraries
that use generated outputs must be rebuilt from the captured source before the
publish build can be declared complete.

Hash sorted repository-relative paths and bytes with unambiguous framing.
Reject unsafe or escaping paths, unexpected symlinks, unreadable required inputs,
and missing required roots. No paths, source contents, secret values, or
repository URLs are included in the public response.

Preparing a record does not commit or push source. The next Agent-assisted
publish preparation invokes the command automatically. The publish build
recalculates the fingerprint and refuses a stale prepared record.

API and web builds must consume the same prepared source identity. Only after
both complete successfully, with unchanged source inputs, may the pipeline seal
the release build record into the deployed artifact. A development-only or
partial build is never presented as a complete publish build.

If the build container lacks Git metadata, use the independently prepared record
only after its source fingerprint matches. Never substitute a checksum for a Git
commit SHA or silently infer a Git revision from the current workspace.

The deployed artifact's source identity does not change with later editor edits,
GitHub pushes, runtime environment overrides, or ordinary server restarts.

## 2. Read-only version endpoint

Add public `GET /api/build-info`, mounted with health-only public routes before
business-route authentication. It performs no database query, session creation,
or operation on production records.

The bounded, versioned response includes:

- Application build ID and fingerprint-policy version.
- Source fingerprint.
- Verified Git revision or `null`, with an explicit binding status.
- Build completion time and complete/development build classification.
- Optional platform deployment/build IDs with their separate provenance.

The handler reads the sealed artifact record, not repository `HEAD` or a
mutable runtime version label. Use `Cache-Control: no-store` so an older response
cannot silently satisfy a new verification attempt.

A valid record can report an unavailable Git binding without inventing one.
An absent or malformed artifact record returns a safe JSON failure with an
explicit unavailable status, not a fabricated successful identity. No account,
recipe, operational, filesystem, credential, or infrastructure details are
exposed.

Document the route in OpenAPI and regenerate clients/validators normally.
Update public-route authorization inventories and assembled-router tests.
Do not change authentication or capabilities for any existing business route.

## 3. Automatic published-version verification

Add a `verify-published-build` command that accepts the independently prepared
expected record and the official published target selected through deployment
metadata. Do not construct the production URL from environment variables or
the project name.

The command:

1. Validates the expected record before making a request.
2. Fetches `/api/build-info` with a timeout and a bounded response size.
3. Rejects unexpected redirects, non-success responses, unsupported versions,
   malformed records, and incomplete/development builds.
4. Compares the complete published source fingerprint and application build ID
   with the expected record. Checks verified Git binding when present.
5. Produces a bounded verification receipt identifying the expected record,
   observed artifact, capture time, result, and unresolved identity requirements.

A match establishes an application-source version match, **not production GO**.
The endpoint's echo alone is not an independent expected source record, and a
SHA-256 fingerprint is not a cryptographic provider attestation.

Wire this result into the release preparation/evidence flow. Keep existing
controlled deployment handoffs, revision-bound reconciliation, source-audit,
readiness, expiry, browser, and release-evidence requirements intact.
Any additional artifact-identity provenance must be explicitly versioned and
validated; it must not quietly relabel an application ID as a platform ID or
turn unverified runtime metadata into a provider-verified handoff.

Where a legacy release check requires a full Git revision or platform binding,
missing proof remains BLOCKED with a specific reason. The helper supplies
verified source information where available; it does not waive another gate.
Legacy handoff records retain their existing meaning and validation.

## Testing and acceptance

Use focused Node/API tests and temporary source trees; do not publish or query
production data while testing.

Required cases:

- Stable fingerprints despite directory traversal order; changes to included
  source/config/assets/lockfile inputs change the fingerprint.
- Excluded outputs/secrets/evidence do not enter the record or public response.
- Untracked source inputs, unsafe symlinks, missing roots, dirty source, unavailable
  Git, stale preparation, and edits between build stages cannot acquire a false
  verified Git binding or a complete release stamp.
- API and web build stamps agree; a failed/partial build is not complete.
- Immutable loaded version survives editor changes and server restart.
- Public route is reachable without signing in and without database access;
  protected business routes remain protected.
- Timeouts, redirects, oversized responses, malformed identities, old servers,
  wrong IDs/fingerprints, and forged/unverified Git fields fail explicitly.
- A matching isolated expected record and served sealed artifact produce a
  source-match receipt, not a production GO report.
- Existing controlled-handoff rejection and release-evidence tests remain valid.

Run generated-API checks, targeted tests, typechecks, and a single managed API
restart after implementation. Verify metadata through a direct HTTP request;
no new operational browser journey is introduced.

## Scope exclusions

No database/schema changes, signing-key changes, GitHub pushes, historical
metadata retagging, source-data heals, UI redesign, production mutation, or
automatic publishing. Live verification of this new capability requires a
subsequent owner-approved publish; the old app remains unchanged until then.