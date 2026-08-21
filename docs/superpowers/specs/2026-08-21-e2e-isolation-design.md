# E2E isolation and cleanup design

## Goal

Make destructive browser coverage safe to run only against a disposable
database, while allowing phone-layout and PWA checks to run independently and
in any order.

## Boundaries

- The main Playwright configuration owns live-day scenarios and performs the
  one required daily reset.
- The screen-off/wake scenarios repeat only that reset per test because the
  state is factory-wide.
- Phone layout creates unique accounts but does not reset live-day state.
  Those accounts are tracked and deleted after the suite.
- PWA handoff uses only temporary build directories and a temporary HTTP
  server; it has no database or application server dependency.

## Safety and lifecycle

A shared guard rejects destructive setup unless the connection is local, the
database name explicitly identifies a disposable test database, or both
approved test-mode variables are present. `REPLIT_DEV_DOMAIN` alone is never
accepted. Database clients close in `finally` blocks, and temporary accounts,
entity fixtures, servers, and directories are cleaned by their owning suite.

## Verification

The supported independent commands are:

- `pnpm --filter @workspace/run-calculator run test:pwa-handoff`
- `pnpm --filter @workspace/run-calculator run test:e2e:phone`
- `E2E_TEST_DB=1 E2E_APPROVED_DESTRUCTIVE_MODE=1 pnpm --filter @workspace/run-calculator run test:e2e`

The PWA and phone configs remain separate from the destructive main config, so
their order does not change database state.