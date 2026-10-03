# Failure-only responsive WebKit diagnostics

## Goal

Give release owners useful browser-state diagnostics when the full release's
phone/tablet WebKit journeys fail, without uploading raw Playwright captures or
adding debug files to canonical release evidence.

## Design

- Limit this path to the full release's `phone-webkit` and `tablet-webkit`
  projects. Their tests continue to run against the isolated disposable
  database.
- Keep Playwright's raw trace files in the runner workspace only. On a failed
  journey, produce a separate, reduced diagnostic bundle containing:
  - a reviewed failure screenshot captured with form fields and account-related
    regions masked;
  - a trace summary with static test/project identity, safe step categories,
    source locations, elapsed times, and failure type;
  - a manifest identifying the workflow run, revision, fixture environment,
    sanitizer version, and failure-only status.
- Do not copy raw traces, raw screenshots, request or response data, headers,
  cookies, storage state, page snapshots, arbitrary error text, or query
  strings into the bundle. If required diagnostic data cannot be safely
  produced, fail closed for that item rather than retaining its raw source.
- Upload the sanitized bundle as a separate GitHub Actions artifact only when
  the responsive WebKit gate has a failed journey. Use three-day retention.
  Passing runs produce no bundle. The canonical release-evidence directory and
  its allowlist remain unchanged.

## Failure handling

The debug artifact is supplementary and never changes the gate result. A
sanitizer failure must not turn a failed gate into a pass, and must not cause
raw files to be uploaded as a fallback. The release result and existing
revision-bound compatibility report remain the authoritative evidence.

## Verification

- Exercise the sanitizer with a failing synthetic fixture containing canary
  credentials, query values, request bodies, storage values, and dynamic page
  text; verify the retained summary remains useful and none of those values
  appear in the bundle.
- Exercise a passing fixture and verify it creates no uploadable debug bundle.
- Verify workflow checks keep the debug artifact separate from the canonical
  release-evidence path and apply short retention.