# V2 isolated pilot deployment record

**Status: BLOCKED — no pilot deployment was attempted.**

Captured 2026-11-16, America/Chicago.

## Environment and source

- Environment checked: current Replit workspace, which contains the archived V1
  project and the V2 source under `v2/`.
- Source revision: `8e30787bd0140dd5c768f51e2eec3af146754823`. The tracked V2 source
  is at this revision.
- The current project is not deployed. Its deployment settings remain fail-closed;
  they must not be changed to publish V2 from this project.
- No separate V2 Replit project or V2 database is available through the current
  workspace's workflows, artifacts, or deployment controls. No project-creation
  integration is available in this session. Replit's documented copy/fork and
  ZIP-import paths require the project owner to create or open the destination.

## Data and secrets boundary

- No V1 database was queried or changed. No production data, V1 credentials,
  sessions, or inventory were used.
- The current workspace does not have `V2_DATABASE_URL` or
  `V2_INITIAL_MANAGER_BOOTSTRAP_CODE` configured. Only their presence was checked;
  no secret values were read.
- No database connection or deployment was attempted because there is no isolated
  V2 project and database to target.

## Checks completed

These checks use the local source and disposable local test fixtures. They do not
prove deployment or production behavior.

| Check | Result |
| --- | --- |
| V2 unit/API tests | PASS — 122 tests |
| V2 browser tests | PASS — 7 tests in emulated Chromium; no physical-device claim |
| V2 PostgreSQL checks | PASS — temporary local PostgreSQL cluster |
| Runtime contract | PASS — Node 24.22.2, pnpm 12.21.0 |
| Replit deployment | NOT RUN — isolated project and database unavailable |
| Platform connection ceiling | UNKNOWN — no pilot database was available to measure |

## Gaps before the pilot

- `v2/server/main.mjs` currently starts the station worker inside the API process.
  The approved pilot requires separately supervised API and worker processes, so
  the source topology still needs that preparation before deployment.
- The current API pool defaults to a maximum of five connections per process.
  The worker's separate-process pool budget and total platform/database limit
  have not been measured.
- Process restart, whole-deployment restart, and worker/API sharing of a V2-owned
  database remain unverified.

## Owner prerequisite and next action

Create or share a **separate V2 Replit project** with its own disposable
PostgreSQL database, then provide the project link and grant access to that
project. Do not connect it to V1 data or secrets. Once access is available, the
agent can prepare the supervised process topology, configure V2-only settings
through that project's secret controls, and run the synthetic pilot. Do not paste
database URLs, bootstrap codes, or other secret values into chat.
