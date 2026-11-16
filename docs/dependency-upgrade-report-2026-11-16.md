# Workspace dependency upgrade report — 2026-11-16

## Outcome

Updated eligible workspace dependencies and aligned the pinned runtime,
lockfile, GitHub Actions, and container builder. No new package was added.
The generated inventory is in
[`dependency-workspace-inventory-2026-11-16.json`](./dependency-workspace-inventory-2026-11-16.json).

## Direct package updates

| Package | Previous | Updated |
| --- | --- | --- |
| `@google/genai` | `2.30.0` | `3.3.0` |
| `@hookform/resolvers` | `5.9.2` | `7.0.6` |
| `@playwright/test` | `1.64.1` | `1.65.1` |
| `@tailwindcss/vite` | `4.3.3` | `4.3.5` |
| `@tanstack/react-query` | `5.104.4` | `5.107.1` |
| `@testing-library/user-event` | `14.6.8` | `14.6.10` |
| `@types/node` | `26.6.5` | `26.6.6` |
| `@vitejs/plugin-react` | `6.1.2` | `6.3.0` |
| `jsdom` | `30.1.3` | `31.0.1` |
| `lucide-react` | `1.59.0` | `1.73.0` |
| `openai` | `7.38.0` | `7.57.0` |
| `orval` | `8.46.0` | `8.48.0` |
| `p-retry` | `8.0.1` | `9.0.0` |
| `prettier` | `3.9.10` | `3.10.1` |
| `react-hook-form` | `7.90.0` | `7.92.0` |
| `react-resizable-panels` | `4.14.5` | `4.23.0` |
| `tailwindcss` | `4.3.3` | `4.3.5` |
| `thread-stream` | `4.2.0` | `4.2.1` |
| `typedoc-plugin-markdown` | `4.14.0` | `4.14.1` |
| `vite` | `8.3.4` | `8.3.8` |
| `vitest` | `5.0.5` | `5.1.0` |
| `web-push` | `3.6.7` | `4.0.0` |

The `web-push` v4 migration now uses its ESM exports and bundled types; the
separate `@types/web-push` package was removed. `@google/genai` v3 explicitly
requests `v1beta` to preserve the prior API behavior. Generated Orval clients
and schemas were regenerated. The `wouter` declaration now uses the existing
workspace catalog entry; its resolved version did not change. Vitest and
`@vitest/mocker` overrides now match Vitest `5.1.0`, and the esbuild override
range is `^0.28.2`.

`@types/node` is type-only and remains on major 26, as it was before this task;
it does not select the Node runtime. All runtime and build execution was
verified on Node `24.22.2`. A future type-surface alignment decision is listed
with the remaining dependency holds below.

## Runtime, workflows, and containers

- Node is pinned to `24.22.2`; pnpm is pinned to `12.21.0`. The `.replit`
  Project workflow, Node runner, CI, Docker builder, tests, and README use the
  agreed runtime/toolchain contract.
- GitHub Actions remain SHA-pinned. All current action releases and immutable
  SHAs were checked against upstream release/tag information; workflow diffs
  only update the `pnpm/action-setup` pin to v6.1.1. No triggers, permissions,
  secrets, caches, artifact boundaries, or deployment authority changed.
- The Caddy image now names `2.11.9-alpine` while retaining its verified digest.
- The Docker builder snapshot moved to `20261015T000000Z` after the pinned Node
  image's installed `perl-base` `5.36.0-7+deb12u4` conflicted with the August
  snapshot's `5.36.0-7+deb12u3`. The October snapshot supplies matching
  `perl`/`perl-base` packages. The reviewed package record is in
  [`container-builder-security-refresh.md`](./container-builder-security-refresh.md).
- API, web, and migration-smoke container targets passed. The no-cache API
  image build also passed.

## Verification

| Check | Result |
| --- | --- |
| Frozen workspace install | Passed |
| Calculator client tests | 398 files passed, 1 skipped; 3,932 tests passed, 1 skipped |
| API isolated unit tests | 137 files; 1,371/1,371 passed |
| OpenAI integration tests | 30/30 passed |
| Full workspace typecheck | Passed on Node `24.22.2` |
| Workflow syntax/action check | Passed for 15 workflow files |
| Strict dependency-use check | Passed |
| Clean-start check | Passed: API readiness, web, sign-in fallback, proxy, and Vite reconnect checks |
| Production dependency audit | Passed; no known production vulnerabilities |
| Peer dependency check | Passed; peer requirements satisfied |
| Docker API, web, and migration-smoke targets | Passed |
| No-cache Docker API build | Passed |
| `git diff --check` | Passed after the final documentation edits |

The full isolated browser suite initially ran 241 cases: 236 passed and 5
failed. Focused reruns clarified the failures:

- The field-check export test had stale v1 expectations. Its expectation was
  updated to schema v2 and server-reported development provenance; the focused
  rerun passed.
- The visual saved-state test passed after its settling timeout was raised to
  15 seconds.
- The sync-convergence test passed in its focused rerun after failing once in
  the full run.
- The accessibility smoke test still fails honestly: six requests
  (`/api/me`, `/api/sync/today`, `/api/field-checks/observations`, and
  `/api/incidents`) remained in flight after the test's 15-second wait before
  an intentional reload. This is browser wait evidence; it does not establish
  server processing time, and the requests were not whitelisted as harmless.
- The Packaging wake/reload test still disagrees with its expected case count:
  it observed 46 to 49 cases where the test expected 47, with server and client
  claims overlapping. The timing evidence may reflect multiple elapsed
  six-second intervals; whether this is a product defect or a test expectation
  issue remains unresolved. No production auto-tracking behavior was changed.

The whole browser suite was not rerun after those test-only corrections. The
two remaining focused findings are separate from the package changes and need
follow-up investigation.

The local `run-release-node.test.sh` suite passed its first 13 checks, then
could not bind IPv6 loopback (`EAFNOSUPPORT` for `::1`). The TLS behavior was not
weakened or skipped; this local environment cannot verify that case.

## Deferred dependency and release items

- `@testing-library/user-event` `14.6.11` and `14.6.12` were published within
  the 24-hour minimum-age window; the workspace remains at `14.6.10`. The
  newest version becomes eligible at `2026-11-17 02:31Z`.
- TypeScript `7.0.2` remains held because of documented workspace compatibility
  blockers; TypeScript `6.0.3` passes the full typecheck.
- Full audit reports one low-severity, unpatched `deepmerge` advisory through
  `vite-plugin-pwa` / Workbox. The production audit is clean.
- `node-domexception@1.0.0` remains deprecated transitively through the
  Google-auth/fetch dependency chain; no upstream fix was available.
- Existing `web-push` is MPL-2.0. No dependency was added, but the license
  remains subject to the workspace's policy review.
- Review whether the type-only `@types/node` major should align to Node 24, or
  remain intentionally ahead of the runtime.
- `npm` prints informational warnings for the existing pnpm-only
  `auto-install-peers` and `strict-peer-dependencies` configuration keys.

The standard release check did not run release gates because published release
evidence is missing. Production readiness is **NO-GO**. No production database
was read or changed, and nothing was published.
