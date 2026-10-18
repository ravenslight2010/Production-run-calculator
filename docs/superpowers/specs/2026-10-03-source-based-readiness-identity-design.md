# Source-based test and readiness identity

## Goal

GitHub is a backup, not this application's publishing source. New test,
readiness, reconciliation, and release approval records must not require a
GitHub identifier, backup push, branch tip, or Git commit revision.

Use the application's immutable build identity and independently captured
production-source fingerprint instead. Keep the existing verification gates.

## Recommended approach

Introduce an explicit source-based evidence contract and update its producers
and consumers together. Do not merely remove Git-format validation or accept
unidentified evidence.

Alternatives:

- Removing the revision requirement without a replacement is unsafe: reports
  could describe different code and still be accepted.
- Keeping Git mandatory but automating its lookup still conflicts with the
  owner's publishing workflow.

## Identity and trust

- A source version is the explicit namespaced value
  `source-sha256:<64 lowercase hexadecimal characters>` together with its
  source-policy version. It is not a Git SHA.
- A published artifact is identified by its `app-build:…` ID. It is not a
  Replit deployment or internal Build UUID.
- Test evidence must bind to the production-source fingerprint actually
  assessed. Published evidence must additionally bind to the intended
  application build.
- Bind test reports separately to a verification-input fingerprint covering
  the applicable tests, fixtures, configurations, gate definitions, and
  validation policies. The production-source fingerprint deliberately excludes
  tests, so it cannot alone detect changed test requirements. Old results must
  not satisfy a new verification-input fingerprint even when app code matches.
- Obtain the official live URL through deployment metadata. Compare the public
  complete-release build record with an independently prepared expectation.
  Never derive that expectation from the response being checked.
- Git and runtime-reported platform IDs remain optional annotations. Missing
  annotations cannot block the new source-based path, and annotations cannot
  substitute for its source proof.
- Missing, mismatched, stale, development, malformed, or incomplete source
  identity still blocks approval.

## Changes as one coherent unit

1. Add a shared source-identity contract for evidence validation and comparison.
2. Make published-version comparison depend on build ID, source policy, and
   source fingerprint, not the presence or equality of optional Git metadata.
3. Add a versioned source-based deployment handoff produced only after the
   independent expected/live comparison succeeds. Bind its expiry, expected
   record digest, build ID, policy, and fingerprint. Do not relabel an ordinary
   source-match receipt as an older trusted handoff.
4. Update readiness capture and retained-evidence validation to consume that
   handoff without a Git revision.
5. Update source-library reconciliation evidence and import validation to use
   the same source identity while retaining the production/database,
   report-hash, repair-boundary, and capture-time fences.
6. Update standard/full release runners, report validators, evidence handoffs,
   and their browser/evaluation evidence producers wherever they currently
   require a Git revision for the release being assessed. Their identities must
   agree; changing only the readiness collector is insufficient.
7. Update operating instructions and project safety guidance so future agents
   do not reintroduce Git/GitHub as a requirement.

## Compatibility and safety

- Preserve historical Git-bound reports and their original meaning. Read them
  through an explicit legacy path; never silently convert a Git SHA to a
  source fingerprint or rewrite historical proof.
- New records and normal approval commands default to source-based identity.
  Compatibility must not force a new publish to provide a Git revision.
- Keep all required test, generated-client, security, readiness, browser,
  production-reconciliation, expiry, and report-integrity checks.
- Do not introduce an `unknown`-identity approval, unconditional skip, forged
  revision, or blanket exception.
- No production publishing, writes, data heals, schema changes, or unrelated
  UI changes are part of implementation.
- Do not change task-owned Git/backup checks into release blockers. Git-specific
  backup or historical-CI tools may retain their identifiers for their own
  explicitly requested purposes.

## Verification

- Prove the new path works with no `.git` directory and with
  `gitRevision: null` in the published build record.
- Prove matching source/build identities pass the identity gates, while
  different source, build, policy, stale timestamps, and partial/development
  builds fail.
- Prove source-match-only and legacy records cannot bypass the new handoff
  contract or the remaining approval gates.
- Prove reconciliation, readiness, release reports, and applicable
  browser/evaluation evidence agree on the same source identity.
- Prove changing a test or required gate invalidates old test evidence even
  when the production-source fingerprint remains unchanged.
- Preserve legacy-reader regression coverage without requiring GitHub access.
- Run focused contract tests and relevant typechecks; then perform a
  read-only rehearsal against the published app with its existing independent
  source expectation. Label that rehearsal non-authoritative; do not claim
  full production readiness from identity checks or health observations alone.

## Completion

The rehearsal no longer asks for Git/GitHub identifiers. A complete readiness
assessment can use the source-based identity throughout, and any remaining
blocker describes actual missing or failed verification rather than a missing
Git revision.