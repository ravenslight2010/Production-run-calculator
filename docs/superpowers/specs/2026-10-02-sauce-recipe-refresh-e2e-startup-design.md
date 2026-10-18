# Sauce Recipe Refresh Browser-Test Startup

## Problem

The isolated recipe-refresh Playwright config does not start the local API and
web servers used by the release browser configs. Its fixture signup therefore
fails with `ECONNREFUSED` before the recipe-refresh journey begins, leaving
Sauce behavior untested.

## Design

Use the shared release-browser URL and server helpers in the recipe-refresh
config, and run the existing database-guarded global setup. Keep the dedicated
disposable-database requirement and the current single-worker, no-retry test
policy. Do not alter Sauce behavior, fixture assertions, cross-browser
assertions, or Start-freeze checks.

## Alternatives

- Reuse the shared server helpers (recommended): matches the established
  isolated browser path and avoids duplicated startup commands.
- Add bespoke API/web startup commands: duplicates the existing server contract
  and risks drift.
- Use the remote development preview: it would not be bound to the disposable
  test database and is not safe for this destructive fixture suite.

## Verification

Run the dedicated recipe-refresh suite through the fresh isolated-browser
runner. Confirm that Sauce edits update pending runs in both browser contexts,
then verify that subsequent edits leave the started run unchanged after reload.
All existing cross-device assertions remain enabled.